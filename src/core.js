'use strict';

import Promise from 'bluebird';
import isString from 'lodash/isString';
import isArray from 'lodash/isArray';
import isPlainObject from 'lodash/isPlainObject';
import isBoolean from 'lodash/isBoolean';
import isFunction from 'lodash/isFunction';
import forIn from 'lodash/forIn';
import forEach from 'lodash/forEach';
import has from 'lodash/has';
import each from 'lodash/each';
import logger from './logging';
import errors from './errors';

// Constants to denote access control rules
const ALLOW = 'allow';
const DENY = 'deny';

// For different keywords that we defined with `and` or `or` operations,
// we should use different bookshelf model methods,
// this mappings provides simpler way to decide what method name to use.
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
    and: 'where', // for the `and` keyword, conditions should be ANDed together
    or: 'orWhere' // for the `or` keyword, conditions should be ORed together
}

// There are many string matching operations in PostgreSQL, here we chain the bookshelf instance
// with like operations according to the column, value, like operations and logical operations.
let addLikeClause = function (knex, builder, col, value, likeOp, logicOp) {
    if (isString(value)) {
        value = [].concat(value);
    }
    if (isArray(value)) {
        builder = builder[methodMap.where[logicOp]](function() {
            let qb = this;
            each(value, function(str) {
                let preparation = `${col} ${likeOp} ?`;
                if (likeOp.indexOf('like') !== -1) {
                    str = `%%${str}%%`;
                }
                qb.orWhere(knex.raw(preparation, [str]));
            })
        })
        return builder;
    } else {
        throw errors.ErrLikeShouldBeStringOrList;
    }
}

// j2s provides different suffixes that could be appended to columns,
// to specify what kind of comparison operators to use.
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
        if (!isArray(value)) {
            throw errors.ErrBetweenSuffixValueShouldBeList;
        }
        if (value.length != 2) {
            throw errors.ErrBetweenSuffixValueShouldBeLengthTwo;
        }
        return builder[methodMap.between[op]](col, value);
    },
    'not_between': (knex, builder, col, value, op) => {
        if (!isArray(value)) {
            throw errors.ErrNotBetweenSuffixShouldBeList;
        }
        if (value.length != 2) {
            throw errors.ErrNotBetweenSuffixShouldBeLengthTwo;
        }
        return builder[methodMap.not_between[op]](col, value);
    },
    'in': (knex, builder, col, value, op) => {
        if (!isArray(value)) {
            throw errors.ErrInSuffixShouldBeList;
        }
        return builder[methodMap.in[op]](col, value);
    },
    'not_in': (knex, builder, col, value, op) => {
        if (!isArray(value)) {
            throw erros.ErrNotInSuffixShouldBeList;
        }
        return builder[methodMap.not_in[op]](col, value);
    },
    'null': (knex, builder, col, value, op) => {
        if (!isBoolean(value)) {
            throw errors.ErrNullSuffixShouldBeBoolean;
        }
        if (value) {
            return builder[methodMap.where_null[op]](col);
        } else {
            return builder[methodMap.where_not_null[op]](col);
        }
    },
}

// For the SQL EXISTS query, recursively parse the query conditions
// to form a subquery.
function existsQuery(knex, table, value) {
    this.from(table);
    if (!has(value, 'where')) {
        this.select('*');
        parseConditions(knex, this, value);
    } else {
        builderQuery(knex, this, value);
    }
}

// accepts knex query builder and conditions object, returns the builder
function parseConditions(knex, builder, conds, op) {
    // default logical operation is `and`
    if (!op) {
        op = 'and';
    }
    if (isPlainObject(conds)) {
        conds = [conds]
    }
    // allow conditions to be represented as array of condition objects
    each(conds, cond => {
        // loop through key value pairs of the condition object
        forIn(cond, (v, k) => {
            let parts = k.split('__'); // suffix is appended to column names with double underscores
            if (parts.length == 1) {
                if (k == 'or' || k == 'and') {
                    // if key is the keyword `and` or `or`, recursively parse the value,
                    // with according logical operation
                    builder = builder[methodMap[op]](function() {
                        parseConditions(knex, this, v, k)
                    })
                } else if (k == 'exists' || k == 'not_exists') {
                    // handle EXISTS queries, recursively parse them
                    forIn(v, function(value, key) {
                        builder = builder[methodMap[k][op]](function() {
                            existsQuery.call(this, knex, key, value)
                        })
                    })

                } else {
                    // for simple 'column equals to value' scenario, simply add a raw preparation
                    let preparation = knex.raw('?? = ?', [k, v]);
                    if (isString(v)) {
                        let words = v.split('.');
                        let reg = /^([A-Za-z]|[0-9]|_|\$)+$/
                        if (words.length == 2 && words[0].match(reg) && words[1].match(reg)) {
                            // value is an identifier
                            preparation = knex.raw('?? = ??', [k, v])
                        }
                    }
                    builder = builder[methodMap.where[op]](preparation)
                }
            } else if (parts.length == 2) {
                // if column name is followed by suffix,
                // call the suffix callback and handle the query
                let col = parts[0];
                let suffix = parts[1];
                if (!has(whereSuffixes, suffix)) {
                    throw errors.FnErrSuffixNotImplemented(suffix);
                }
                builder = whereSuffixes[suffix](knex, builder, col, v, op);
            }
        })
    })
    return builder;
}

// handle JOIN operation, if there's a subquery,
// recursively parse it
function join(builder, method, value) {
    if (!isPlainObject(value)) {
        throw errors.ErrJoinShouldBeJSONObject;
    }
    forEach(value, (v, k) => {
        if (has(v, 'subquery')) {
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

// j2s provided keywords that maps to SQL operations
const keywords = {
    'where': (knex, builder, value, key) => {
        if (key == 'or') {
            return parseConditions(knex, builder, value, 'or');
        }
        return parseConditions(knex, builder, value, 'and');
    },
    'join': (knex, builder, value, key) => {
        return join(builder, builder.join, value);
    },
    'inner_join': (knex, builder, value, key) => {
        return join(builder, builder.innerJoin, value);
    },
    'left_join': (knex, builder, value, key) => {
        return join(builder, builder.leftJoin, value);
    },
    'left_outer_join': (knex, builder, value, key) => {
        return join(builder, builder.leftOuterJoin, value);
    },
    'right_join': (knex, builder, value, key) => {
        return join(builder, builder.rightJoin, value);
    },
    'right_outer_join': (knex, builder, value, key) => {
        return join(builder, builder.rightOuterJoin, value);
    },
    'full_outer_join': (knex, builder, value, key) => {
        return join(builder, builder.fullOuterJoin, value);
    },
    'cross_join': (knex, builder, value, key) => {
        return builder.crossJoin(value)
    },
    'select': (knex, builder, value, key) => {
        return builder.select.apply(builder, value);
    },
    'limit': (knex, builder, value, key) => {
        return builder.limit(value);
    },
    'offset': (knex, builder, value, key) => {
        return builder.offset(value);
    },
    'group_by': (knex, builder, value, key) => {
        return builder.groupBy(value);
    },
    'order_by': (knex, builder, value, key) => {
        if (!isArray(value)) {
            value = [value];
            throw errors.ErrOrderByShouldBeList;
        }
        if (value.length > 2) {
            throw errors.ErrOrderByLengthShouldBeTwo;
        }
        return builder.orderBy.apply(builder, value);
    },
    'count': (knex, builder, value, key) => {
        if (isArray(value))  {
            each(value, function(col) {
                builder = builder.count(col)
            })
        } else {
            builder = builder.count(value)
        }
        return builder;
    },
    'min': (knex, builder, value, key) => {
        return builder.min(value);
    },
    'max': (knex, builder, value, key) => {
        return builder.max(value);
    },
    'avg': (knex, builder, value, key) => {
        return builder.avg(value);
    },
    'sum': (knex, builder, value, key) => {
        return builder.sum(value);
    },
    'populate': (knex, builder, value, key) => {
        // noop
        return builder;
    },
    'add_attr': (knex, builder, value, key) => {
        // noop
        return builder;
    },
    'add_clause': (knex, builder, value, key) => {
        // noop
        return builder;
    }
}

// accepts a knex query builder, parse the query clauses and chain the methods,
// return the builder
function builderQuery(knex, builder, clauses) {
    forIn(clauses, (value, key) => {
        if (!has(keywords, key)) {
            throw errors.FnErrKeywordNotImplemented(key);
        }
        builder = keywords[key](knex, builder, value, key)
    })
    logger.debug('builder query statement: %s', builder.toString())
    return builder
}

// accepts a bookshelf model, parse the query clauses and chain the methods,
// return a bookshelf collection
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

// check access control rules, return a Promise that resolves to true or false
async function check(ctx, identityCB, adminCB, instances, rule) {
    if (!identityCB) {
        return true;
    }
    if (rule == ALLOW) {
        return true;
    }
    let identity = await identityCB(ctx);
    let isAdmin = await adminCB(identity);
    if (isAdmin) {
        return true;
    }
    if (rule == DENY) {
        return false;
    }
    if (!isArray(instances)) {
        instances = instances.toArray()
    }
    // TODO: run checks in parallel
    for (var i = 0; i < instances.length; i++) {
        let instance = instances[i];
        if (isPlainObject(rule)) {
            for (var key in rule) {
                if (identity[key] != instance.get(rule[key])) {
                    return false;
                }
            }
        } else if (isFunction(rule)) {
            return rule(identity, instance, ctx);
        } else {
            throw errors.FnErrUnknowRuleType(rule);
        }
    }
    return true;
}

module.exports = {
    builderQuery: builderQuery,
    query: query,
    check: check,
    ALLOW: ALLOW,
    DENY: DENY
}
