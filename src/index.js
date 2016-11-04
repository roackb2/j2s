'use strict';

const _ = require('lodash');
const core = require('./core');
const errors = require('./errors');
const Router = require('koa-router');
const Promise = require('bluebird');

const accessProps = ['C', 'R', 'U', 'D']

function setupController(bookshelf, controller, path, model, identityCB, adminCB, authCB, rules) {
    let getOne = function (ctx, next) {
        return model.where('id', ctx.params.id).fetchAll().then(function (instances) {
            return Promise.all([
                instances,
                core.check(ctx, identityCB, adminCB, instances, rules.R)
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
            queryPromise = core.query(model, query).fetchAll({
                withRelated: query.populate
            })
        } else {
            queryPromise = core.query(model, query).fetchAll()
        }
        return queryPromise.then(function(instances) {
            return Promise.all([
                instances,
                core.check(ctx, identityCB, adminCB, instances, rules.R)
            ])
        }).spread(function(instances, check) {
            if (!check) {
                throw errors.ErrOperationNotAuthorized;
            }
            ctx.body = {data: instances}
        })
    };

    let post = function (ctx, next) {
        let data = ctx.request.body.data
        if (!_.isArray(data)) {
            data = [data]
        }
        let modelCollection = bookshelf.Collection.extend({
            model: model
        })
        let instances = modelCollection.forge(data)
        return core.check(ctx, identityCB, adminCB, instances, rules.C).then(function(check) {
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
        let instances = core.query(model, query)
        return core.check(ctx, identityCB, adminCB, instances, rules.U).then(function(check) {
            if (!check) {
                throw errors.ErrOperationNotAuthorized;
            }
            return instances.save(data, {method: 'update', patch: true})
        }).then(function(res) {
            ctx.body = {data: res}
        })
    };

    let del = function (ctx, next) {
        let query = ctx.request.body.query
        if (!_.isPlainObject(query)) {
            throw errors.ErrQueryShouldBeJsonObject;
        }
        let instances = core.query(model, query)
        return core.check(ctx, identityCB, adminCB, instances, rules.D).then(function(check) {
            if (!check) {
                throw errors.ErrOperationNotAuthorized;
            }
            return instances.destroy()
        }).then(function(res) {
            ctx.body = {data: res}
        })
    };

    if (authCB) {
        controller
        .get(path + '/:id', authCB, getOne)
        .get(path, authCB, get)
        .post(path, authCB, post)
        .put(path, authCB, put)
        .delete(path, authCB, del)
    } else {
        controller
        .get(path + '/:id', getOne)
        .get(path, get)
        .post(path, post)
        .put(path, put)
        .delete(path, del)
    }
}

function J2S(opts) {
    opts = opts || {}
    const prefix = opts.prefix || ''
    const defaultAccess = opts.defaultAccess || {
        C: core.ALLOW,
        R: core.ALLOW,
        U: core.ALLOW,
        D: core.ALLOW,
    }
    const routes = opts.routes;
    const bookshelf = opts.bookshelf;
    const controller = new Router({
        prefix: prefix
    });
    const defaultAuthCB = opts.defaultAuth;
    const identityCB = opts.identity;
    const adminCB = opts.admin || function() {return Promise.resolve(false)};
    _.forEach(routes, function(item, path) {
        let model = item;
        let rules = defaultAccess;
        let authCB = defaultAuthCB;
        if (_.isPlainObject(item)) {
            model = item.model
            _.each(accessProps, prop => {
                if (!_.has(item, prop)) {
                    item[prop] = defaultAccess[prop]
                }
            })
            if (_.has(item, 'auth')) {
                if (item.auth === 'ignore') {
                    authCB = null;
                } else {
                    authCB = item.auth;
                }
            }
            rules = _.pick(item, accessProps)
        }
        setupController(bookshelf, controller, path, model, identityCB, adminCB, authCB, rules);
    })
    return controller;
}

J2S.ALLOW = core.ALLOW;
J2S.DENY = core.DENY;
J2S.errors = errors;

module.exports = J2S
