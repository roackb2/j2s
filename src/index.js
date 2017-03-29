'use strict';

const _ = require('lodash');
const core = require('./core');
const errors = require('./errors');
const Router = require('koa-router');
const Promise = require('bluebird');

const methods = ['C', 'R', 'U', 'D'];
const configProps = ['access', 'identity', 'admin', 'middlewares'];

function chainFuncs (ctx, instances, funcs) {
    if (funcs.length > 0) {
        let func = funcs.shift();
        return Promise.all(instances.invokeMap(func, ctx)).then(function(results) {
            for(var i = 0; i < instances.length; i++) {
                instances.at(i).set(func, results[i]);
            }
            return chainFuncs(ctx, instances, funcs);
        });
    } else {
        return instances;
    }
}

function chainClauses (model, clauses, ctx, query) {
    if (clauses.length > 0) {
        let clause = clauses.shift();
        if (_.isString(clause)) {
            if (!_.has(model, clause)) {
                throw errors.FnErrClauseNotExists(clause);
            }
            return model[clause](ctx, query).then(function(modifiedQuery) {
                return chainClauses(model, clauses, ctx, modifiedQuery);
            })
        } else if (_.isPlainObject(clause)) {
            let keys = _.keys(clause);
            if (keys.length !== 1) {
                throw errors.FnErrClauseObjectShouldHaveExactlyOneKey(keys);
            }
            let key = keys[0];
            let value = clause[key];
            if (!_.has(model, key)) {
                throw errors.FnErrClauseNotExists(key);
            }
            return model[key](ctx, query, value).then(function(modifiedQuery) {
                return chainClauses(model, clauses, ctx, modifiedQuery)
            })
        } else {
            throw errors.ErrAddClauseElementShouldBeStringOrObject;
        }
    } else {
        return query;
    }
}

function setupController(bookshelf, controller, path, opts, forbids) {
    let knex = bookshelf.knex;
    let errHandler = function(err) {
        if (err instanceof errors.J2SError) {
            throw err;
        } else {
            throw errors.FnErrDatabaseOperationError(err.message);
        }
    }

    let getOne = function (ctx, next) {
        return opts.model.where('id', ctx.params.id).fetchAll().then(function (instances) {
            return Promise.all([
                instances,
                core.check(ctx, opts.identity.R, opts.admin.R, instances, opts.access.R)
            ])
        }).spread(function (instances, check) {
            if (!check) {
                throw errors.ErrOperationNotAuthorized;
            }
            let instance = instances.toJSON()
            if (instance.length > 0) {
                instance = instance[0]
            }
            ctx.body = {data: instance}
        }).catch(errHandler);
    };

    let get = function (ctx, next) {
        let query = {}
        if (ctx.request.query.query) {
            query = JSON.parse(ctx.request.query.query)
        }
        if (!_.isPlainObject(query)) {
            throw errors.ErrQueryShouldBeJsonObject;
        }
        _.each(_.keys(query), function(key) {
            if (_.includes(forbids, key)) {
                throw errors.FnErrKeyForbidden(key);
            }
        })
        let fetchOpts = {};
        if (_.has(query, 'populate')) {
            if (!_.isArray(query.populate)) {
                throw errors.ErrPopulateShouldBeList;
            }
            let populate = _.map(query.populate, function(population) {
                if (_.isPlainObject(population)) {
                    let keys = _.keys(population)
                    if (keys.length != 1) {
                        throw errors.ErrPopulateObjectShouldHaveExactlyOneKey
                    }
                    let key = keys[0]
                    let res = {}
                    res[key] = function(builder) {
                        core.builderQuery(knex, builder, population[key])
                    }
                    return res;
                } else if (_.isString(population)){
                    return population;
                } else {
                    throw errors.ErrPopulateElementShouldBeStringOrObject;
                }
            })
            fetchOpts = {withRelated: populate}
        }
        let finalPromise = null;
        if (_.has(query, 'add_clause')) {
            let clauses = query.add_clause
            if (!_.isArray(clauses)) {
                throw errors.ErrExtraShouldBeList;
            }
            finalPromise = chainClauses(opts.model, clauses, ctx, query).then(function(modifiedQuery) {
                return core.query(bookshelf, opts.model, modifiedQuery).fetch(fetchOpts);
            })
        } else {
            finalPromise = core.query(bookshelf, opts.model, query).fetch(fetchOpts);
        }
        return finalPromise.then(function(instances) {
            return Promise.all([
                instances,
                core.check(ctx, opts.identity.R, opts.admin.R, instances, opts.access.R)
            ])
        }).spread(function(instances, check) {
            if (!check) {
                throw errors.ErrOperationNotAuthorized;
            }
            if (_.has(query, 'add_attr')) {
                return chainFuncs(ctx, instances, query.add_attr);
            } else {
                return instances;
            }
        }).then(function (instances) {
            ctx.body = {data: instances}
        }).catch(errHandler);
    };

    let post = function (ctx, next) {
        let data = ctx.request.body.data
        if (!_.isArray(data)) {
            data = [data]
        }
        let modelCollection = bookshelf.Collection.extend({
            model: opts.model
        })
        let instances = modelCollection.forge(data)
        return core.check(ctx, opts.identity.C, opts.admin.C, instances, opts.access.C).then(function(check) {
            if (!check) {
                throw errors.ErrOperationNotAuthorized;
            }
            return instances.invokeThen('save');
        }).then(function(res) {
            ctx.body = {data: res}
        }).catch(errHandler);
    };

    let put = function (ctx, next) {
        let query = ctx.request.body.query
        if (!_.isPlainObject(query)) {
            throw errors.ErrQueryShouldBeJsonObject;
        }
        let data = ctx.request.body.data
        if (!_.isPlainObject(data)) {
            throw errors.ErrDataShouldBeJsonObject;
        }
        return core.query(bookshelf, opts.model, query).fetch().then(function(instances) {
            return Promise.all([
                instances,
                core.check(ctx, opts.identity.U, opts.admin.U, instances, opts.access.U)
            ])
        }).spread(function(instances, check) {
            if (!check) {
                throw errors.ErrOperationNotAuthorized;
            }
            return instances.invokeThen('save', data, {method: 'update', patch: true});
        }).then(function(res) {
            ctx.body = {data: res}
        }).catch(errHandler);
    };

    let del = function (ctx, next) {
        let query = ctx.request.body.query
        if (!_.isPlainObject(query)) {
            throw errors.ErrQueryShouldBeJsonObject;
        }
        return core.query(bookshelf, opts.model, query).count().then(function(count) {
            if (count > 1) {
                throw errors.ErrDeletionNotAllowed;
            }
            return core.query(bookshelf, opts.model, query).fetch();
        }).then(function(instances) {
            return Promise.all([
                instances,
                core.check(ctx, opts.identity.D, opts.admin.D, instances, opts.access.D)
            ])
        }).spread(function(instances, check) {
            if (!check) {
                throw errors.ErrOperationNotAuthorized;
            }
            return instances.invokeThen('destroy')
        }).then(function(res) {
            if (res.length == 0) {
                throw errors.ErrResourceNotFound;
            }
            ctx.body = {success: true};
        }).catch(errHandler);
    };


    controller.get.apply(controller, [path + '/:id'].concat(opts.middlewares.R).concat([getOne]));
    controller.get.apply(controller, [path].concat(opts.middlewares.R).concat([get]));
    controller.post.apply(controller, [path].concat(opts.middlewares.C).concat([post]));
    controller.put.apply(controller, [path].concat(opts.middlewares.U).concat([put]));
    controller.delete.apply(controller, [path].concat(opts.middlewares.D).concat([del]));
}

function setDefaultOpts(content) {
    let obj = {};
    _.each(methods, function(method) {
        obj[method] = content;
    })
    return obj
}

function setOptions(res, defaultOpts) {
    _.each(configProps, function(prop) {
        if (_.has(defaultOpts, prop) && !_.isNil(defaultOpts, prop)) {
            if (_.isPlainObject(defaultOpts[prop])) {
                _.each(methods, function(method) {
                    res[prop][method] = defaultOpts[prop][method];
                })
            } else {
                res[prop] = setDefaultOpts(defaultOpts[prop]);
            }
        }
    })
    return res;
}

function resolveOptions(defaultOpts, route) {
    let res = {
        access: setDefaultOpts(core.ALLOW),
        identity: setDefaultOpts(defaultOpts.identity), // identity could not be optional
        admin: setDefaultOpts(function() {return Promise.resolve(false)}),
        middlewares: setDefaultOpts([]),
    };
    res = setOptions(res, defaultOpts);
    if (_.isPlainObject(route)) {
        res.model = route.model;
        res = setOptions(res, route);
    } else {
        res.model = route;
    }
    return res;
}

function J2S(defaultOpts) {
    defaultOpts = defaultOpts || {}
    const prefix = defaultOpts.prefix || ''
    const routes = defaultOpts.routes;
    const bookshelf = defaultOpts.bookshelf;
    const forbids = defaultOpts.forbids || [];
    const controller = new Router({
        prefix: prefix
    });
    _.forEach(routes, function(route, path) {
        let resolvedOpts = resolveOptions(defaultOpts, route);
        setupController(bookshelf, controller, path, resolvedOpts, forbids);
    })
    return controller;
}

J2S.ALLOW = core.ALLOW;
J2S.DENY = core.DENY;
J2S.errors = errors;

module.exports = J2S
