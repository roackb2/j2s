'use strict';

const _ = require('lodash');
const core = require('./core');
const errors = require('./errors');
const router = require('koa-router');
const Promise = require('bluebird');

const accessProps = ['C', 'R', 'U', 'D']

function setupController(bookshelf, controller, path, model, identityCB, adminCB, authCB, rules) {
    let getOne = function* (next) {
        let instances = yield model.where('id', this.params.id).fetchAll() || []
        let check = yield core.check(this, identityCB, adminCB, instances, rules.R)
        if (!check) {
            throw errors.ErrOperationNotAuthorized;
        }
        let instance = instances.toJSON()
        if (instance.length > 0) {
            instance = instance[0]
        }
        this.body = {data: instance}
    };

    let get = function* (next) {
        let query = {}
        if (this.request.query.query) {
            query = JSON.parse(this.request.query.query)
        }
        if (!_.isPlainObject(query)) {
            throw errors.ErrQueryShouldBeJsonObject;
        }
        let instances = []
        if (_.has(query, 'populate')) {
            instances = yield core.query(model, query).fetchAll({
                withRelated: query.populate
            })
        } else {
            instances = yield core.query(model, query).fetchAll()
        }
        let check = yield core.check(this, identityCB, adminCB, instances, rules.R)
        if (!check) {
            throw errors.ErrOperationNotAuthorized;
        }
        this.body = {data: instances}
    };

    let post = function* (next) {
        let data = this.request.body.data
        if (!_.isArray(data)) {
            data = [data]
        }
        let modelCollection = bookshelf.Collection.extend({
            model: model
        })
        let instances = modelCollection.forge(data)
        let check = yield core.check(this, identityCB, adminCB, instances, rules.C)
        if (!check) {
            throw errors.ErrOperationNotAuthorized;
        }
        let res = yield instances.invokeThen('save')
        this.body = {data: res}
    };

    let put = function* (next) {
        let query = this.request.body.query
        if (!_.isPlainObject(query)) {
            throw errors.ErrQueryShouldBeJsonObject;
        }
        let data = this.request.body.data
        if (!_.isPlainObject(data)) {
            throw errors.ErrDataShouldBeJsonObject;
        }
        let instances = core.query(model, query)
        let check = yield core.check(this, identityCB, adminCB, instances, rules.U)
        if (!check) {
            throw errors.ErrOperationNotAuthorized;
        }
        let res = yield instances.save(data, {method: 'update', patch: true})
        this.body = {data: res}
    };

    let del = function* (next) {
        let query = this.request.body.query
        if (!_.isPlainObject(query)) {
            throw errors.ErrQueryShouldBeJsonObject;
        }
        let instances = core.query(model, query)
        let check = yield core.check(this, identityCB, adminCB, instances, rules.D)
        if (!check) {
            throw errors.ErrOperationNotAuthorized;
        }
        let res = yield instances.destroy()
        this.body = {data: res}
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
    const controller = router();
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
        path = prefix + path
        setupController(bookshelf, controller, path, model, identityCB, adminCB, authCB, rules);
    })
    return controller;
}

J2S.ALLOW = core.ALLOW;
J2S.DENY = core.DENY;
J2S.errors = errors;

module.exports = J2S
