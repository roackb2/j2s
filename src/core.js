'use strict';

const _ = require('lodash');
const knex = require('knex');
const util = require('util');
const logger = require('./logging');
const errors = require('./errors');
const Promise = require('bluebird');

const ALLOW = 'allow';
const DENY = 'deny';

const methodMap = {
    exists: {
        and: 'whereExists',
        or: 'orWhereExists'
    },
    not_exists: {
        and: 'whereNotExists',
        or: 'orWhereNotExists'
    },
    where: {
        and: 'where',
        or: 'orWhere'
    },
    where_not: {
        and: 'whereNot',
        or: 'orWhereNot'
    },
    between: {
        and: 'whereBetween',
        or: 'orWhereBetween'
    },
    not_between: {
        and: 'whereNotBetween',
        or: 'orWhereNotBetween'
    },
    in: {
        and: 'whereIn',
        or: 'orWhereIn'
    },
    not_in: {
        and: 'whereNotIn',
        or: 'orWhereNotIn'
    },
    where_null: {
        and: 'whereNull',
        or: 'orWhereNull'
    },
    where_not_null: {
        and: 'whereNotNull',
        or: 'orWhereNotNull'
    },
    and: 'where',
    or: 'orWhere'
}

let addLikeClause = function (knex, builder, col, value, likeOp, logicOp) {
    if (_.isString(value)) {
        value = [].concat(value);
    }
    if (_.isArray(value)) {
        builder = builder[methodMap.where[logicOp]](function() {
            let qb = this;
            _.each(value, function(str) {
                let preparation = util.format('%s %s ?', col, likeOp);
                if (likeOp.indexOf('like') !== -1) {
                    str = util.format('%%%s%%', str)
                }
                qb.orWhere(knex.raw(preparation, [str]));
            })
        })
        return builder;
    } else {
        throw errors.ErrLikeShouldBeStringOrList;
    }
}

const whereSuffixes = {
    'gt': (knex, builder, col, value, op) => {
        return builder[methodMap.where[op]](col, '>', value);
    },
    'gte': (knex, builder, col, value, op) => {
        return builder[methodMap.where[op]](col, '>=', value);
    },
    'lt': (knex, builder, col, value, op) => {
        return builder[methodMap.where[op]](col, '<', value);
    },
    'lte': (knex, builder, col, value, op) => {
        return builder[methodMap.where[op]](col, '<=', value);
    },
    'ne': (knex, builder, col, value, op) => {
        return builder[methodMap.where_not[op]](col, value);
    },
    'like': (knex, builder, col, value, op) => {
        return addLikeClause(knex, builder, col, value, 'like', op);
    },
    'not_like': (knex, builder, col, value, op) => {
        return addLikeClause(knex, builder, col, value, 'not like', op);
    },
    'ilike': (knex, builder, col, value, op) => {
        return addLikeClause(knex, builder, col, value, 'ilike', op);
    },
    'not_ilike': (knex, builder, col, value, op) => {
        return addLikeClause(knex, builder, col, value, 'not ilike', op);
    },
    'reg_like': (knex, builder, col, value, op) => {
        return addLikeClause(knex, builder, col, value, '~', op);
    },
    'reg_not_like': (knex, builder, col, value, op) => {
        return addLikeClause(knex, builder, col, value, '!~', op);
    },
    'reg_ilike': (knex, builder, col, value, op) => {
        return addLikeClause(knex, builder, col, value, '~*', op);
    },
    'reg_not_ilike': (knex, builder, col, value, op) => {
        return addLikeClause(knex, builder, col, value, '!~*', op);
    },
    'between': (knex, builder, col, value, op) => {
        if (!_.isArray(value)) {
            throw errors.ErrBetweenSuffixValueShouldBeList;
        }
        if (value.length != 2) {
            throw errors.ErrBetweenSuffixValueShouldBeLengthTwo;
        }
        return builder[methodMap.between[op]](col, value);
    },
    'not_between': (knex, builder, col, value, op) => {
        if (!_.isArray(value)) {
            throw errors.ErrNotBetweenSuffixShouldBeList;
        }
        if (value.length != 2) {
            throw errors.ErrNotBetweenSuffixShouldBeLengthTwo;
        }
        return builder[methodMap.not_between[op]](col, value);
    },
    'in': (knex, builder, col, value, op) => {
        if (!_.isArray(value)) {
            throw errors.ErrInSuffixShouldBeList;
        }
        return builder[methodMap.in[op]](col, value);
    },
    'not_in': (knex, builder, col, value, op) => {
        if (!_.isArray(value)) {
            throw erros.ErrNotInSuffixShouldBeList;
        }
        return builder[methodMap.not_in[op]](col, value);
    },
    'null': (knex, builder, col, value, op) => {
        if (!_.isBoolean(value)) {
            throw errors.ErrNullSuffixShouldBeBoolean;
        }
        if (value) {
            return builder[methodMap.where_null[op]](col);
        } else {
            return builder[methodMap.where_not_null[op]](col);
        }
    },
}

function existsQuery(knex, table, value) {
    this.from(table);
    if (!_.has(value, 'where')) {
        this.select('*');
        parseConditions(knex, this, value);
    } else {
        builderQuery(knex, this, value);
    }
}

// accepts knex query builder and conditions object, returns the builder
function parseConditions(knex, builder, conds, op) {
    if (!op) {
        op = 'and';
    }
    _.forIn(conds, (v, k) => {
        let parts = k.split('__');
        if (parts.length == 1) {
            if (k == 'or' || k == 'and') {
                builder = builder[methodMap[op]](function() {
                    parseConditions(knex, this, v, k)
                })
            } else if (k == 'exists' || k == 'not_exists') {
                let keys = _.keys(v);
                if (keys.length != 1) {
                    throw errors.ErrExistsObjectShouldHaveExactlyOneKey;
                }
                let key = keys[0];
                let value = v[key];
                builder = builder[methodMap[k][op]](function() {
                    existsQuery.call(this, knex, key, value)
                })
            } else {
                let preparation = null;
                if (_.isString(v) && v.split('.').length > 1) {
                    // value is an identifier
                    preparation = knex.raw('?? = ??', [k, v])
                } else {
                    preparation = knex.raw('?? = ?', [k, v])
                }
                builder = builder[methodMap.where[op]](preparation)
            }
        } else if (parts.length == 2) {
            let col = parts[0];
            let suffix = parts[1];
            if (!_.has(whereSuffixes, suffix)) {
                throw errors.FnErrSuffixNotImplemented(suffix);
            }
            builder = whereSuffixes[suffix](knex, builder, col, v, op);
        }
    })
    return builder;
}

function join(builder, method, value) {
    if (!_.isPlainObject(value)) {
        throw errors.ErrJoinShouldBeJSONObject;
    }
    _.forEach(value, (v, k) => {
        if (_.has(v, 'subquery')) {
            builder = method.call(builder, function() {
                this.from(k)
                builderQuery(this, v.subquery).as(v.as)
            }, v.on)
        } else {
            builder = method.call(builder, k, v);
        }
    })
    return builder;
}

const keywords = {
    'where': (knex, builder, value) => {
        return parseConditions(knex, builder, value, 'and');
    },
    'join': (knex, builder, value) => {
        return join(builder, builder.join, value);
    },
    'inner_join': (knex, builder, value) => {
        return join(builder, builder.innerJoin, value);
    },
    'left_join': (knex, builder, value) => {
        return join(builder, builder.leftJoin, value);
    },
    'left_outer_join': (knex, builder, value) => {
        return join(builder, builder.leftOuterJoin, value);
    },
    'right_join': (knex, builder, value) => {
        return join(builder, builder.rightJoin, value);
    },
    'right_outer_join': (knex, builder, value) => {
        return join(builder, builder.rightOuterJoin, value);
    },
    'full_outer_join': (knex, builder, value) => {
        return join(builder, builder.fullOuterJoin, value);
    },
    'cross_join': (knex, builder, value) => {
        return builder.crossJoin(value)
    },
    'select': (knex, builder, value) => {
        return builder.select.apply(builder, value);
    },
    'limit': (knex, builder, value) => {
        return builder.limit(value);
    },
    'offset': (knex, builder, value) => {
        return builder.offset(value);
    },
    'group_by': (knex, builder, value) => {
        return builder.groupBy(value);
    },
    'order_by': (knex, builder, value) => {
        if (!_.isArray(value)) {
            value = [value];
            throw errors.ErrOrderByShouldBeList;
        }
        if (value.length > 2) {
            throw errors.ErrOrderByLengthShouldBeTwo;
        }
        return builder.orderBy.apply(builder, value);
    },
    'count': (knex, builder, value) => {
        if (_.isArray(value))  {
            _.each(value, function(col) {
                builder = builder.count(col)
            })
        } else {
            builder = builder.count(value)
        }
        return builder;
    },
    'min': (knex, builder, value) => {
        return builder.min(value);
    },
    'max': (knex, builder, value) => {
        return builder.max(value);
    },
    'avg': (knex, builder, value) => {
        return builder.avg(value);
    },
    'sum': (knex, builder, value) => {
        return builder.sum(value);
    },
    'populate': (knex, builder, value) => {
        // noop
        return builder;
    },
    'add_attr': (knex, builder, value) => {
        // noop
        return builder;
    },
    'add_clause': (knex, builder, value) => {
        // noop
        return builder;
    }
}

// accepts a knex query builder
function builderQuery(knex, builder, clauses) {
    _.forIn(clauses, (value, key) => {
        if (!_.has(keywords, key)) {
            throw errors.FnErrKeywordNotImplemented(key);
        }
        builder = keywords[key](knex, builder, value)
    })
    logger.debug('builder query statement: %s', builder.toString())
    return builder
}

// accepts a bookshelf model
function query(bookshelf, model, clauses) {
    let collection = bookshelf.Collection.extend({
        model: model
    })
    let m = collection.query(function(builder) {
        builder = builderQuery(bookshelf.knex, builder, clauses)
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
                        if (identity[key] != instance.get(rule[key])) {
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
    builderQuery: builderQuery,
    query: query,
    check: check,
    ALLOW: ALLOW,
    DENY: DENY
}
