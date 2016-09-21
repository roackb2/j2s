const _ = require('lodash');
const core = require('./core')
const router = require('koa-router');

module.exports = function(opts) {
    opts = opts || {}
    const prefix = opts.prefix || ''
    const routes = opts.routes
    const controller = router()
    _.forEach(routes, function(model, path) {
        path = prefix + path
        controller.get(path + '/:id', function*(next) {
            let instance = yield model.where('id', this.params.id).fetch() || {}
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
            this.body = {data: instances}
        })
        .post(path, function*(next) {
            data = this.request.body.data
            if (!_.isArray(data)) {
                data = [data]
            }
            instances = []
            for (var i = 0; i < data.length; i++) {
                item = data[i]
                res = yield model.forge(item).save()
                instances.push(res)
            }
            this.body = {data: instances}
        })
        .put(path, function*(next) {
            query = this.request.body.query
            if (!_.isPlainObject(query)) {
                throw new Error('value of `query` must be JSON object')
            }
            data = this.request.body.data
            if (!_.isPlainObject(data)) {
                throw new Error('value of `data` must be JSON object')
            }
            res = yield core.query(model, query).save(data, options={method: "update"})
            res = res.toJSON()
            this.body = {data: res}
        })
        .delete(path, function*(next) {
            query = this.request.body.query
            if (!_.isPlainObject(query)) {
                throw new Error('value of `query` must be JSON object')
            }
            res = yield core.query(model, query).destroy()
            res = res.toJSON()
            this.body = {data: res}
        })
    })
    return controller;
}
