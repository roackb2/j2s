'use strict';

const _ = require('lodash');
const util = require('util');
const logger = require('./logging');
const Promise = require('bluebird');

const ALLOW = 'allow';
const DENY = 'deny';

const whereSuffixes = {
    'gt': (builder, col, value) => {
        return builder.where(col, '>', value);
    },
    'gte': (builder, col, value) => {
        return builder.where(col, '>=', value);
    },
    'lt': (builder, col, value) => {
        return builder.where(col, '<', value);
    },
    'lte': (builder, col, value) => {
        return builder.where(col, '<=', value);
    },
    'ne': (builder, col, value) => {
        return builder.whereNot(col, value);
    },
    'between': (builder, col, value) => {
        if (!_.isArray(value)) {
            throw new Error('value for query clause with `between` suffix must be list');
        }
        if (value.length != 2) {
            throw new Error('value for query clause with `between` suffix must be list of length 2');
        }
        return builder.whereBetween(col, value);
    },
    'not_between': (builder, col, value) => {
        if (!_.isArray(value)) {
            throw new Error('value for query clause with `not_between` suffix must be list');
        }
        if (value.length != 2) {
            throw new Error('value for query clause with `not_between` suffix must be list of length 2');
        }
        return builder.whereNotBetween(col, value);
    },
    'in': (builder, col, value) => {
        if (!_.isArray(value)) {
            throw new Error('value for query clause with `in` suffix must be list');
        }
        return builder.whereIn(col, value);
    },
    'not_in': (builder, col, value) => {
        if (!_.isArray(value)) {
            throw new Error('value for query clause with `not_in` suffix must be list');
        }
        return builder.whereIn(col, value);
    },
    'null': (builder, col, value) => {
        if (!_.isBoolean(value)) {
            throw new Error('value for query clause with `not_in` suffix must be boolean');
        }
        if (value) {
            return builder.whereNull(col);
        } else {
            return builder.whereNotNull(col);
        }
    }
}

function parserConditions(builder, conds, model) {
    _.forIn(conds, (v, k) => {
        let parts = k.split('__');
        if (parts.length == 1) {
            if (k == 'or') {
                builder = builder.orWhere(function() {
                    parserConditions(this, v, model)
                })
            } else {
                builder = builder.where(function() {
                    this.where(k, v)
                });
            }
        } else if (parts.length == 2) {
            col = parts[0];
            suffix = parts[1];
            if (!_.has(whereSuffixes, suffix)) {
                throw new Error(util.format('suffix `%s` is not implemented', suffix))
            }
            builder = whereSuffixes[suffix](builder, col, v)
        }
    })
    return builder
}

function join(builder, method, value) {
    if (!_.isPlainObject(value)) {
        throw new Error('value of `join should be JSON object`')
    }
    _.forEach(value, (v, k) => {
        builder = method.call(builder, k, v)
    })
    return builder
}

const keywords = {
    'where': (builder, value, model) => {
        return parserConditions(builder, value, model);
    },
    'join': (builder, value) => {
        return join(builder, builder.join, value)
    },
    'inner_join': (builder, value) => {
        return join(builder, builder.innerJoin, value)
    },
    'left_join': (builder, value) => {
        return join(builder, builder.leftJoin, value)
    },
    'left_outer_join': (builder, value) => {
        return join(builder, builder.leftOuterJoin, value)
    },
    'right_join': (builder, value) => {
        return join(builder, builder.rightJoin, value)
    },
    'right_outer_join': (builder, value) => {
        return join(builder, builder.rightOuterJoin, value)
    },
    'full_outer_join': (builder, value) => {
        return join(builder, builder.fullOuterJoin, value)
    },
    'cross_join': (builder, value) => {
        return builder.crossJoin(value)
    },
    'select': (builder, value) => {
        return builder.select.apply(builder, value)
    },
    'limit': (builder, value) => {
        return builder.limit(value)
    },
    'offset': (builder, value) => {
        return builder.offset(value)
    },
    'order_by': (builder, value) => {
        if (!_.isArray(value)) {
            throw new Error('value of `order_by` should be array');
        }
        if (value.length > 2) {
            throw new Error('value of `order_by` could only be of length 1 or 2');
        }
        return builder.orderBy.apply(builder, value)
    },
    'populate': (builder, value) => {
        // noop
        return builder
    },
}

function query(model, clauses) {
    let m = model.query(function(builder) {
        _.forIn(clauses, (value, key) => {
            if (!_.has(keywords, key)) {
                throw new Error(util.format('keyword `%s` is not implemented', key))
            }
            builder = keywords[key](builder, value, model)
        })
        logger.debug('query statement: %s', builder.toString())
    })
    return m
}

function check(ctx, identityCB, instances, rule) {
    if (identityCB) {
        return identityCB(ctx).then(function(identity) {
            if (rule == DENY) {
                return Promise.resolve(false);
            }
            if (rule == ALLOW) {
                return Promise.resolve(true);
            }
            if (!_.isArray(instances)) {
                instances = instances.toArray()
            }
            for (var i = 0; i < instances.length; i++) {
                let instance = instances[i];
                if (_.isPlainObject(rule)) {
                    for (var key in rule) {
                        if (identity[key] != instance[rule[key]]) {
                            return Promise.resolve(false);
                        }
                    }
                } else if (_.isFunction(rule)) {
                    return rule(identity, instance);
                } else {
                    throw new Error(util.format('unknown rule type: %s', rule));
                }
            }
            return Promise.resolve(true);
        })
    } else {
        return Promise.resolve(true);
    }
}

module.exports = {
    query: query,
    check: check,
    ALLOW: ALLOW,
    DENY: DENY
}
