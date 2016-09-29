'use strict';

const _ = require('lodash');
const core = require('./core')
const router = require('koa-router');
const Promise = require('bluebird');

const accessProps = ['C', 'R', 'U', 'D']

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
    const identityCB = opts.identity;
    const adminCB = opts.admin || Promise.resolve(false);
    const controller = router();
    _.forEach(routes, function(item, path) {
        let model = item
        let rules = defaultAccess
        if (_.isPlainObject(item)) {
            model = item.model
            _.each(accessProps, prop => {
                if (!_.has(item, prop)) {
                    item[prop] = defaultAccess[prop]
                }
            })
            rules = _.pick(item, accessProps)
        }
        path = prefix + path
        controller.get(path + '/:id', function*(next) {
            let instances = yield model.where('id', this.params.id).fetchAll() || []
            let check = yield core.check(this, identityCB, instances, rules.R)
            if (!check) {
                throw new Error('operation not authorized')
            }
            let instance = instances.toJSON()
            if (instance.length > 0) {
                instance = instance[0]
            }
            this.body = {data: instance}
        })
        .get(path, function*(next) {
            let query = {}
            if (this.request.query.query) {
                query = JSON.parse(this.request.query.query)
            }
            if (!_.isPlainObject(query)) {
                throw new Error('value of `query` must be JSON object')
            }
            let instances = []
            if (_.has(query, 'populate')) {
                instances = yield core.query(model, query).fetchAll({
                    withRelated: query.populate
                })
            } else {
                instances = yield core.query(model, query).fetchAll()
            }
            let check = yield core.check(this, identityCB, instances, rules.R)
            if (!check) {
                throw new Error('operation not authorized')
            }
            this.body = {data: instances}
        })
        .post(path, function*(next) {
            let data = this.request.body.data
            if (!_.isArray(data)) {
                data = [data]
            }
            let modelCollection = bookshelf.Collection.extend({
                model: model
            })
            let instances = modelCollection.forge(data)
            let check = yield core.check(this, identityCB, instances, rules.R)
            if (!check) {
                throw new Error('operation not authorized')
            }
            let res = yield Promise.all(instances.invokeThen('save'))
            this.body = {data: res}
        })
        .put(path, function*(next) {
            let query = this.request.body.query
            if (!_.isPlainObject(query)) {
                throw new Error('value of `query` must be JSON object')
            }
            let data = this.request.body.data
            if (!_.isPlainObject(data)) {
                throw new Error('value of `data` must be JSON object')
            }
            let instances = yield core.query(model, query)
            let check = yield core.check(this, identityCB, instances, rules.R)
            if (!check) {
                throw new Error('operation not authorized')
            }
            let res = instances.save(data, options={method: "update"}).toJSON()
            this.body = {data: res}
        })
        .delete(path, function*(next) {
            let query = this.request.body.query
            if (!_.isPlainObject(query)) {
                throw new Error('value of `query` must be JSON object')
            }
            let instances = yield core.query(model, query)
            if (identityCB) {
                let identity = yield identityCB(this)
                let check = yield core.check(identity, instances, rules.D)
                if (!check) {
                    throw new Error('operation not authorized')
                }
            }
            let res = instances.destroy().toJSON()
            this.body = {data: res}
        })
    })
    return controller;
}

J2S.ALLOW = core.ALLOW
J2S.DENY = core.DENY

module.exports = J2S
