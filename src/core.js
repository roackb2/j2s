'use strict';

const _ = require('lodash');
const util = require('util');
const logger = require('./logging');
const errors = require('./errors');
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
            throw errors.ErrBetweenSuffixValueShouldBeList;
        }
        if (value.length != 2) {
            throw errors.ErrBetweenSuffixValueShouldBeLengthTwo;
        }
        return builder.whereBetween(col, value);
    },
    'not_between': (builder, col, value) => {
        if (!_.isArray(value)) {
            throw errors.ErrNotBetweenSuffixShouldBeList;
        }
        if (value.length != 2) {
            throw errors.ErrNotBetweenSuffixShouldBeLengthTwo;
        }
        return builder.whereNotBetween(col, value);
    },
    'in': (builder, col, value) => {
        if (!_.isArray(value)) {
            throw errors.ErrInSuffixShouldBeList;
        }
        return builder.whereIn(col, value);
    },
    'not_in': (builder, col, value) => {
        if (!_.isArray(value)) {
            throw erros.ErrNotInSuffixShouldBeList;
        }
        return builder.whereNotIn(col, value);
    },
    'null': (builder, col, value) => {
        if (!_.isBoolean(value)) {
            throw errors.ErrNullSuffixShouldBeBoolean;
        }
        if (value) {
            return builder.whereNull(col);
        } else {
            return builder.whereNotNull(col);
        }
    }
}

// accepts knex query builder and conditions object, returns the builder
function parserConditions(builder, conds) {
    _.forIn(conds, (v, k) => {
        let parts = k.split('__');
        if (parts.length == 1) {
            if (k == 'or') {
                builder = builder.orWhere(function() {
                    parserConditions(this, v);
                })
            } else {
                builder = builder.where(function() {
                    this.where(k, v);
                });
            }
        } else if (parts.length == 2) {
            let col = parts[0];
            let suffix = parts[1];
            if (!_.has(whereSuffixes, suffix)) {
                throw errors.FnErrSuffixNotImplemented(suffix);
            }
            builder = whereSuffixes[suffix](builder, col, v);
        }
    })
    return builder;
}

function join(builder, method, value) {
    if (!_.isPlainObject(value)) {
        throw errors.ErrJoinShouldBeJSONObject;
    }
    _.forEach(value, (v, k) => {
        builder = method.call(builder, k, v);
    })
    return builder;
}

const keywords = {
    'where': (builder, value) => {
        return parserConditions(builder, value);
    },
    'join': (builder, value) => {
        return join(builder, builder.join, value);
    },
    'inner_join': (builder, value) => {
        return join(builder, builder.innerJoin, value);
    },
    'left_join': (builder, value) => {
        return join(builder, builder.leftJoin, value);
    },
    'left_outer_join': (builder, value) => {
        return join(builder, builder.leftOuterJoin, value);
    },
    'right_join': (builder, value) => {
        return join(builder, builder.rightJoin, value);
    },
    'right_outer_join': (builder, value) => {
        return join(builder, builder.rightOuterJoin, value);
    },
    'full_outer_join': (builder, value) => {
        return join(builder, builder.fullOuterJoin, value);
    },
    'cross_join': (builder, value) => {
        return builder.crossJoin(value)
    },
    'select': (builder, value) => {
        return builder.select.apply(builder, value);
    },
    'limit': (builder, value) => {
        return builder.limit(value);
    },
    'offset': (builder, value) => {
        return builder.offset(value);
    },
    'group_by': (builder, value) => {
        return builder.groupBy(value);
    },
    'order_by': (builder, value) => {
        if (!_.isArray(value)) {
            value = [value];
            throw errors.ErrOrderByShouldBeList;
        }
        if (value.length > 2) {
            throw errors.ErrOrderByLengthShouldBeTwo;
        }
        return builder.orderBy.apply(builder, value);
    },
    'count': (builder, value) => {
        return builder.count(value);
    },
    'min': (builder, value) => {
        return builder.min(value);
    },
    'max': (builder, value) => {
        return builder.max(value);
    },
    'avg': (builder, value) => {
        return builder.avg(value);
    },
    'sum': (builder, value) => {
        return builder.sum(value);
    },
    'populate': (builder, value) => {
        // noop
        return builder;
    },
    'fn': (builder, value) => {
        // noop
        return builder;
    }
}

// accepts a knex query builder
function _query(builder, clauses) {
    _.forIn(clauses, (value, key) => {
        if (!_.has(keywords, key)) {
            throw errors.FnErrKeywordNotImplemented(key);
        }
        builder = keywords[key](builder, value)
    })
    return builder
}

// accepts a bookshelf model
function query(model, clauses) {
    let m = model.query(function(builder) {
        builder = _query(builder, clauses)
        logger.debug('query statement: %s', builder.toString())
    })
    return m
}

function check(ctx, identityCB, adminCB, instances, rule) {
    if (!identityCB) {
        return Promise.resolve(true)
    }
    if (rule == ALLOW) {
        return Promise.resolve(true);
    }
    return identityCB(ctx).then(function(identity) {
        return adminCB(identity).then(function(isAdmin) {
            if (isAdmin) {
                return Promise.resolve(true);
            }
            if (rule == DENY) {
                return Promise.resolve(false);
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
                    throw errors.FnErrUnknowRuleType(rule);
                }
            }
            return Promise.resolve(true);
        })
    })
}

module.exports = {
    query: query,
    check: check,
    ALLOW: ALLOW,
    DENY: DENY
}
