'use strict';

const _ = require('lodash');
const core = require('./core');
const errors = require('./errors');
const Router = require('koa-router');
const Promise = require('bluebird');

const methods = ['C', 'R', 'U', 'D'];
const configProps = ['access', 'identity', 'admin', 'middlewares'];

function chainFns (ctx, instances, fns) {
    if (fns.length > 0) {
        let fn = fns.shift();
        return Promise.all(instances.invokeMap(fn, ctx)).then(function(results) {
            for(var i = 0; i < instances.length; i++) {
                instances.at(i).set(fn, results[i]);
            }
            return chainFns(ctx, instances, fns);
        });
    } else {
        return instances;
    }
}

function setupController(bookshelf, controller, path, opts) {
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
        })
    };

    let get = function (ctx, next) {
        let query = {}
        if (ctx.request.query.query) {
            query = JSON.parse(ctx.request.query.query)
        }
        if (!_.isPlainObject(query)) {
            throw errors.ErrQueryShouldBeJsonObject;
        }
        let queryPromise = []
        if (_.has(query, 'populate')) {
            queryPromise = core.query(opts.model, query).fetchAll({
                withRelated: query.populate
            })
        } else {
            queryPromise = core.query(opts.model, query).fetchAll()
        }
        return queryPromise.then(function(instances) {
            return Promise.all([
                instances,
                core.check(ctx, opts.identity.R, opts.admin.R, instances, opts.access.R)
            ])
        }).spread(function(instances, check) {
            if (!check) {
                throw errors.ErrOperationNotAuthorized;
            }
            if (_.has(query, 'fn')) {
                return chainFns(ctx, instances, query.fn);
            } else {
                return instances;
            }
        }).then(function (instances) {
            ctx.body = {data: instances}
        })
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
        })
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
        return core.query(opts.model, query).fetchAll().then(function(instances) {
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
        })
    };

    let del = function (ctx, next) {
        let query = ctx.request.body.query
        if (!_.isPlainObject(query)) {
            throw errors.ErrQueryShouldBeJsonObject;
        }
        return core.query(opts.model, query).fetchAll().then(function(instances) {
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
            ctx.body = {data: res}
        })
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
    const controller = new Router({
        prefix: prefix
    });
    _.forEach(routes, function(route, path) {
        let resolvedOpts = resolveOptions(defaultOpts, route);
        setupController(bookshelf, controller, path, resolvedOpts);
    })
    return controller;
}

J2S.ALLOW = core.ALLOW;
J2S.DENY = core.DENY;
J2S.errors = errors;

module.exports = J2S
