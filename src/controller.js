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
        controller.get(path + '/:id', async(ctx, next) => {
            let instance = await model.where('id', ctx.params.id).fetch() || {}
            ctx.body = {data: instance}
        })
        .get(path, async(ctx, next) => {
            let query = {}
            if (ctx.request.query.query) {
                query = JSON.parse(ctx.request.query.query)
            }
            if (!_.isPlainObject(query)) {
                throw new Error('value of `query` must be JSON object')
            }
            let instances = []
            if (_.has(query, 'populate')) {
                instances = await core.query(model, query).fetchAll({
                    withRelated: query.populate
                })
            } else {
                instances = await core.query(model, query).fetchAll()
            }
            ctx.body = {data: instances}
        })
        .post(path, async (ctx, next) => {
            data = ctx.request.body.data
            if (!_.isArray(data)) {
                data = [data]
            }
            instances = []
            for (var i = 0; i < data.length; i++) {
                item = data[i]
                res = await model.forge(item).save()
                instances.push(res)
            }
            ctx.body = {data: instances}
        })
        .put(path, async (ctx, next) => {
            query = ctx.request.body.query
            if (!_.isPlainObject(query)) {
                throw new Error('value of `query` must be JSON object')
            }
            data = ctx.request.body.data
            if (!_.isPlainObject(data)) {
                throw new Error('value of `data` must be JSON object')
            }
            res = await core.query(model, query).save(data, options={method: "update"})
            res = res.toJSON()
            ctx.body = {data: res}
        })
        .delete(path, async (ctx, next) => {
            query = ctx.request.body.query
            if (!_.isPlainObject(query)) {
                throw new Error('value of `query` must be JSON object')
            }
            res = await core.query(model, query).destroy()
            res = res.toJSON()
            ctx.body = {data: res}
        })
    })
    return controller;
}
