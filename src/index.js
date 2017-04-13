'use strict';

require('babel-polyfill');
import isString from 'lodash/isString';
import isPlainObject from 'lodash/isPlainObject';
import isArray from 'lodash/isArray';
import isNumber from 'lodash/isNumber';
import isNil from 'lodash/isNil';
import includes from 'lodash/includes';
import forIn from 'lodash/forIn';
import forEach from 'lodash/forEach';
import each from 'lodash/each';
import has from 'lodash/has';
import omit from 'lodash/omit';
import pick from 'lodash/pick';
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
        let populate = map(query.populate, function(population) {
            if (isPlainObject(population)) {
                let keys = lodashKeys(population)
                if (keys.length != 1) {
                    throw errors.ErrPopulateObjectShouldHaveExactlyOneKey
                }
                let key = keys[0]
                let res = {}
                res[key] = function(builder) {
                    core.builderQuery(bookshelf.knex, builder, population[key])
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
            throw errors.ErrExtraShouldBeList;
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

async function createInstances(bookshelf, ctx, data, controller, path, opts, forbids) {
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
            let savedInstance = await instance.save(null, {transacting: trx});
            let relationPayload = pick(obj, relationNames);
            for (var key in relationPayload) {
                await modifyRelation(bookshelf, savedInstance, opts.model, key, relationPayload[key], trx);
            }
            return savedInstance;
        })
        return instances;
    })
    return res;
}

async function updateInstances(bookshelf, ctx, query, data, controller, path, opts, forbids) {
    let instances = await core.query(bookshelf, opts.model, query).fetch();
    let check = await core.check(ctx, opts.identity.U, opts.admin.U, instances, opts.access.U);
    if (!check) {
        throw errors.ErrOperationNotAuthorized;
    }
    let res = await bookshelf.transaction(async trx => {
        let emptyInstance = opts.model.forge();
        let relationNames = getRelationNames(bookshelf, emptyInstance, opts.model);
        let attrs = omit(data, relationNames);
        await instances.invokeThen('save', attrs, {transacting: trx, method: 'update', patch: true, require: true, validation: false});
        let relationPayload = pick(data, relationNames);
        await Promise.map(instances.toArray(), async instance => {
            for (var key in relationPayload) {
                await modifyRelation(bookshelf, instance, opts.model, key, relationPayload[key], trx);
            }
            return instance;
        })
        return instances;
    })
    return res;
}

function setupController(bookshelf, controller, path, opts, forbids) {
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
        let instances = await createInstances(bookshelf, ctx, data, controller, path, opts, forbids);
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
        let res = await updateInstances(bookshelf, ctx, query, data, controller, path, opts, forbids);
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
    forEach(routes, function(route, path) {
        let resolvedOpts = resolveOptions(defaultOpts, route);
        setupController(bookshelf, controller, path, resolvedOpts, forbids);
    })
    return controller;
}

J2S.ALLOW = core.ALLOW;
J2S.DENY = core.DENY;
J2S.errors = errors;

module.exports = J2S
