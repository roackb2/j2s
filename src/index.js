'use strict';

require('babel-polyfill');
import isString from 'lodash/isString';
import isPlainObject from 'lodash/isPlainObject';
import isArray from 'lodash/isArray';
import isNumber from 'lodash/isNumber';
import isEmpty from 'lodash/isEmpty';
import isNil from 'lodash/isNil';
import includes from 'lodash/includes';
import forIn from 'lodash/forIn';
import forEach from 'lodash/forEach';
import each from 'lodash/each';
import has from 'lodash/has';
import omit from 'lodash/omit';
import pick from 'lodash/pick';
import keys from 'lodash/keys';
import { default as lodashKeys } from 'lodash/keys';
import map from 'lodash/map';
import Router from 'koa-router';
import Promise from 'bluebird';
import * as core from './core';
import * as errors from './errors';
import { getRelationNames, modifyRelation } from './relation';
const methods = ['C', 'R', 'U', 'D'];
const configProps = ['access', 'identity', 'admin', 'middlewares'];

async function chainFuncs (ctx, instances, funcs) {
    if (funcs.length > 0) {
        let func = funcs.shift();
        let results = await Promise.all(instances.invokeMap(func, ctx));
        for(var i = 0; i < instances.length; i++) {
            instances.at(i).set(func, results[i]);
        }
        let res = await chainFuncs(ctx, instances, funcs);
        return res;
    } else {
        return instances;
    }
}

async function chainClauses (model, clauses, ctx, query) {
    if (clauses.length > 0) {
        let clause = clauses.shift();
        if (isString(clause)) {
            if (!has(model, clause)) {
                throw errors.FnErrClauseNotExists(clause);
            }
            let modifiedQuery = await model[clause](ctx, query);
            let res = await chainClauses(model, clauses, ctx, modifiedQuery);;
            return res;
        } else if (isPlainObject(clause)) {
            let keys = lodashKeys(clause);
            if (keys.length !== 1) {
                throw errors.FnErrClauseObjectShouldHaveExactlyOneKey(keys);
            }
            let key = keys[0];
            let value = clause[key];
            if (!has(model, key)) {
                throw errors.FnErrClauseNotExists(key);
            }
            let modifiedQuery = await model[key](ctx, query, value);
            let res = await chainClauses(model, clauses, ctx, modifiedQuery);
            return res;
        } else {
            throw errors.ErrAddClauseElementShouldBeStringOrObject;
        }
    } else {
        return query;
    }
}

async function getInstances(bookshelf, ctx, query, controller, path, opts, forbids) {
    each(lodashKeys(query), function(key) {
        if (includes(forbids, key)) {
            throw errors.FnErrKeyForbidden(key);
        }
    })
    let fetchOpts = {};
    if (has(query, 'populate')) {
        if (!isArray(query.populate)) {
            throw errors.ErrPopulateShouldBeList;
        }
        let populate = await Promise.map(query.populate, async function(population) {
            if (isPlainObject(population)) {
                let keys = lodashKeys(population)
                if (keys.length != 1) {
                    throw errors.ErrPopulateObjectShouldHaveExactlyOneKey
                }
                let key = keys[0]
                let populateQuery = population[key];
                let res = {};
                res[key] = function(builder) {
                    core.builderQuery(bookshelf.knex, builder, populateQuery);
                }
                if (has(populateQuery, 'add_clause') || has(populateQuery, 'limit') || has(populateQuery, 'offset')) {
                    let relations = key.split('.');
                    let targetModel = opts.model;
                    let relatedData = null;
                    while (relations.length > 0) {
                        let relationName = relations.shift();
                        let relation = targetModel.forge()[relationName]();
                        relatedData = relation.relatedData;
                        targetModel = relatedData.target;
                    }
                    let targetTable = targetModel.forge().tableName;
                    let foreignKey = relatedData.foreignKey;
                    if (has(populateQuery, 'add_clause')) {
                        let clauses = populateQuery.add_clause;
                        if (!isArray(clauses)) {
                            throw errors.ErrAddClauseShouldBeList
                        }
                        populateQuery = await chainClauses(targetModel, clauses, ctx, populateQuery)
                    }
                    if ((has(populateQuery, 'limit') || has(populateQuery, 'offset')) && has(populateQuery, 'order_by')) {
                        let limit = populateQuery.limit;
                        let offset = populateQuery.offset || 0;
                        let orderBy = populateQuery.order_by;
                        delete populateQuery.limit;
                        delete populateQuery.offset;
                        res[key] = function(builder) {
                            builder.with(targetTable, function(qb) {
                                core.builderQuery(bookshelf.knex, qb, populateQuery);
                                qb.select(bookshelf.knex.raw(`*, rank() over (partition by ${foreignKey} order by ${orderBy[0]} ${orderBy[1]}) as rank from ${targetTable}`))
                            }).select('*').from(targetTable);
                            builder.where('rank', '>', offset);
                            if (limit) {
                                builder.andWhere('rank', '<=', limit + offset);
                            }
                        }
                    }
                }
                return res;
            } else if (isString(population)){
                return population;
            } else {
                throw errors.ErrPopulateElementShouldBeStringOrObject;
            }
        })
        fetchOpts = {withRelated: populate}
    }
    if (has(query, 'add_clause')) {
        let clauses = query.add_clause
        if (!isArray(clauses)) {
            throw errors.ErrAddClauseShouldBeList;
        }
        query = await chainClauses(opts.model, clauses, ctx, query);
    }
    let instances = await core.query(bookshelf, opts.model, query).fetch(fetchOpts);
    let check = await core.check(ctx, opts.identity.R, opts.admin.R, instances, opts.access.R);
    if (!check) {
        throw errors.ErrOperationNotAuthorized;
    }
    if (has(query, 'add_attr')) {
        instances = await chainFuncs(ctx, instances, query.add_attr);
    }
    return instances;
}

async function createInstances(bookshelf, ctx, data, controller, path, opts, forbids, allOpts) {
    let modelCollection = bookshelf.Collection.extend({
        model: opts.model
    })
    let res = await bookshelf.transaction(async trx => {
        let emptyInstance = opts.model.forge();
        let relationNames = getRelationNames(bookshelf, emptyInstance, opts.model);
        let instances = await Promise.map(data, async (obj) => {
            let attrs = omit(obj, relationNames);
            let instance = opts.model.forge(attrs);
            let check = await core.check(ctx, opts.identity.C, opts.admin.C, [instance], opts.access.C);
            if (!check) {
                throw errors.ErrOperationNotAuthorized;
            }
            let savedInstance = await instance.save(null, {transacting: trx, method: 'insert', require: true, patch: false});
            let relationPayload = pick(obj, relationNames);
            if (isEmpty(relationPayload)) {
                return savedInstance;
            }
            for (var key in relationPayload) {
                if (isEmpty(relationPayload[key])) {
                    continue;
                }
                await modifyRelation(ctx, bookshelf, savedInstance, opts.model, key, relationPayload[key], trx, allOpts);
            }
            return savedInstance;
        })
        return instances;
    })
    return res;
}

async function updateInstances(bookshelf, ctx, query, data, controller, path, opts, forbids, allOpts) {
    if (isEmpty(query) || isEmpty(query.where)) {
        throw errors.ErrNoQueryOrWhereSupplied;
    }
    let instances = await core.query(bookshelf, opts.model, query).fetch({require: true});
    if (!instances || instances.length == 0) {
        throw errors.ErrResourceNotFound;
    }
    let check = await core.check(ctx, opts.identity.U, opts.admin.U, instances, opts.access.U);
    if (!check) {
        throw errors.ErrOperationNotAuthorized;
    }
    let res = await bookshelf.transaction(async trx => {
        let emptyInstance = opts.model.forge();
        let relationNames = getRelationNames(bookshelf, emptyInstance, opts.model);
        let attrs = omit(data, relationNames);
        if (!isEmpty(attrs)) {
            await instances.invokeThen('save', attrs, {transacting: trx, method: 'update', patch: true, require: true});
        }
        let relationPayload = pick(data, relationNames);
        if (isEmpty(relationPayload)) {
            return instances;
        }
        await Promise.map(instances.toArray(), async instance => {
            for (var key in relationPayload) {
                if (isNil(relationPayload[key])) {
                    return instance;
                }
                await modifyRelation(ctx, bookshelf, instance, opts.model, key, relationPayload[key], trx, allOpts);
            }
            return instance;
        })
        return instances;
    })
    return res;
}

function setupController(bookshelf, controller, path, allOpts, forbids) {
    let opts = allOpts[path];
    let errHandler = function(err) {
        if (err instanceof errors.J2SError) {
            throw err;
        } else {
            throw errors.FnErrDatabaseOperationError(err.message);
        }
    }

    let getOne = async function (ctx, next) {
        let query = {}
        if (ctx.request.query.query) {
            query = JSON.parse(ctx.request.query.query)
        }
        if (!isPlainObject(query)) {
            throw errors.ErrQueryShouldBeJsonObject;
        }
        if (has(query, 'where')) {
            throw errors.ErrWhereKeywordWhenGetWithIdForbidden;
        }
        query.where = {id: ctx.params.id};
        let instances = await getInstances(bookshelf, ctx, query, controller, path, opts, forbids);
        let instance = instances.toJSON()
        if (instance.length > 0) {
            instance = instance[0]
        }
        ctx.body = {data: instance}
    };

    let get = async function (ctx, next) {
        let query = {}
        if (ctx.request.query.query) {
            query = JSON.parse(ctx.request.query.query)
        }
        if (!isPlainObject(query)) {
            throw errors.ErrQueryShouldBeJsonObject;
        }
        let instances = await getInstances(bookshelf, ctx, query, controller, path, opts, forbids);
        ctx.body = {data: instances}
    };

    let post = async function (ctx, next) {
        let data = ctx.request.body.data
        if (!isArray(data)) {
            data = [data]
        }
        let instances = await createInstances(bookshelf, ctx, data, controller, path, opts, forbids, allOpts);
        ctx.body = {data: instances};
    };

    let put = async function (ctx, next) {
        let query = ctx.request.body.query
        if (!isPlainObject(query)) {
            throw errors.ErrQueryShouldBeJsonObject;
        }
        let data = ctx.request.body.data
        if (!isPlainObject(data)) {
            throw errors.ErrDataShouldBeJsonObject;
        }
        let res = await updateInstances(bookshelf, ctx, query, data, controller, path, opts, forbids, allOpts);
        ctx.body = {data: res}
    };

    let del = async function (ctx, next) {
        let query = ctx.request.body.query
        if (!isPlainObject(query)) {
            throw errors.ErrQueryShouldBeJsonObject;
        }
        let count = await core.query(bookshelf, opts.model, query).count();
        if (count > 1) {
            throw errors.ErrDeletionNotAllowed;
        }
        let instances = await core.query(bookshelf, opts.model, query).fetch();
        let check = await core.check(ctx, opts.identity.D, opts.admin.D, instances, opts.access.D);
        if (!check) {
            throw errors.ErrOperationNotAuthorized;
        }
        let res = await instances.invokeThen('destroy');
        if (res.length == 0) {
            throw errors.ErrResourceNotFound;
        }
        ctx.body = {success: true};
    };


    controller.get.apply(controller, [path + '/:id'].concat(opts.middlewares.R).concat([getOne]));
    controller.get.apply(controller, [path].concat(opts.middlewares.R).concat([get]));
    controller.post.apply(controller, [path].concat(opts.middlewares.C).concat([post]));
    controller.put.apply(controller, [path].concat(opts.middlewares.U).concat([put]));
    controller.delete.apply(controller, [path].concat(opts.middlewares.D).concat([del]));
}

function setDefaultOpts(content) {
    let obj = {};
    each(methods, function(method) {
        obj[method] = content;
    })
    return obj
}

function setOptions(res, defaultOpts) {
    each(configProps, function(prop) {
        if (has(defaultOpts, prop) && !isNil(defaultOpts, prop)) {
            if (isPlainObject(defaultOpts[prop])) {
                each(methods, function(method) {
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
    if (isPlainObject(route)) {
        res.model = route.model;
        res = setOptions(res, route);
    } else {
        res.model = route;
    }
    let emptyInstance = res.model.forge();
    res.tableName = emptyInstance.tableName;
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
    let allResolvedOpts = {}
    delete routes.default
    forEach(routes, function(route, path) {
        allResolvedOpts[path] = resolveOptions(defaultOpts, route);
    })
    forEach(keys(routes), function(path) {
        setupController(bookshelf, controller, path, allResolvedOpts, forbids);
    })
    return controller;
}

J2S.ALLOW = core.ALLOW;
J2S.DENY = core.DENY;
J2S.errors = errors;

module.exports = J2S
