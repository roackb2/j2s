'use strict';

function J2SError(code, message, status) {
    this.success = false;
    this.code = code;
    this.message = message;
    if (status) {
        this.status = status;
    }
 }

J2SError.prototype = Object.create(Error.prototype);
J2SError.prototype.name = "J2SError";
J2SError.prototype.success = false;
J2SError.prototype.code = -1;
J2SError.prototype.message = "";
J2SError.prototype.status = 500;
J2SError.prototype.constructor = J2SError;

module.exports = {
    J2SError: J2SError,
    ErrBetweenSuffixValueShouldBeList: new J2SError(100101, `value for query clause with 'between' suffix must be list`),
    ErrBetweenSuffixValueShouldBeLengthTwo: new J2SError(100102, `value for query clause with 'between' suffix must be list of length 2`),
    ErrNotBetweenSuffixShouldBeList: new J2SError(100103, `value for query clause with 'not_between' suffix must be list`),
    ErrNotBetweenSuffixShouldBeLengthTwo: new J2SError(100104, `value for query clause with 'not_between' suffix must be list of length 2`),
    ErrInSuffixShouldBeList: new J2SError(100105, `value for query clause with 'in' suffix must be list`),
    ErrNotInSuffixShouldBeList: new J2SError(100106, `value for query clause with 'not_in' suffix must be list`),
    ErrNullSuffixShouldBeBoolean: new J2SError(100107, `value for query clause with 'null' suffix must be boolean`),
    FnErrSuffixNotImplemented: function(suffix) {
        return new J2SError(100108, `suffix '${suffix}' is not implemented`);
    },
    ErrJoinShouldBeJSONObject: new J2SError(100108, `value of 'join' should be JSON object`),
    ErrOrderByShouldBeList: new J2SError(100109, `value of 'order_by' should be list`),
    ErrOrderByLengthShouldBeTwo: new J2SError(100110, `value of 'order_by' could only be of length 1 or 2`),
    FnErrKeywordNotImplemented: function(keyword) {
        return new J2SError(100111, `keyword '${keyword}' is not implemented`);
    },
    FnErrUnknowRuleType: function(rule) {
        return new J2SError(100112, `unknown rule type: ${rule}`);
    },
    ErrOperationNotAuthorized: new J2SError(100113, `operation not authorized`),
    ErrQueryShouldBeJsonObject: new J2SError(100115, `value of 'query' must be JSON object`),
    ErrDataShouldBeJsonObject: new J2SError(100117, `value of 'data' must be JSON object`),
    ErrPopulateShouldBeList: new J2SError(100118, `value of 'populate' must be JSON array`),
    ErrPopulateObjectShouldHaveExactlyOneKey: new J2SError(100119, `value of element in 'populate' with object type should have exactly one key`),
    ErrPopulateElementShouldBeStringOrObject: new J2SError(100120, `value of element in 'populate' should be either JSON object or string`),
    ErrExistsObjectShouldHaveExactlyOneKey: new J2SError(100121, `value of 'exists' or 'not_exists' should be JSON object that contains exactly one key`),
    ErrAddClauseShouldBeList: new J2SError(100122, `value of 'add_clause' should be JSON Array`),
    FnErrKeyForbidden: function(keyword) {
        return new J2SError(100123, `keyword '${keyword}' is forbidden`);
    },
    ErrAddClauseElementShouldBeStringOrObject: new J2SError(100124, `value of element in 'add_clause' should be either JSON object or string`),
    ErrLikeShouldBeStringOrList: new J2SError(100125, `value of 'like' should be either JSON array or string`),
    ErrDeletionNotAllowed: new J2SError(100126, `deletion for more than one instance is not allowed`),
    ErrResourceNotFound: new J2SError(100127, `resource not found`),
    FnErrDatabaseOperationError: function(msg) {
        return new J2SError(100128, `DB operation error: ${msg}`);
    },
    FnErrClauseNotExists: function(clause) {
        return new J2SError(100129, `clause '${clause}' is not defined on the model`);
    },
    FnErrClauseObjectShouldHaveExactlyOneKey: function(keys) {
        return new J2SError(100130, `clause should have exactly one key, but got [${keys}]`);
    },
    ErrWhereKeywordWhenGetWithIdForbidden: new J2SError(100131, `the 'where' keyword is not allowed when get objects with id`),
    FnErrValueShouldBeObject: function(key) {
        return new J2SError(100132, `the value of key '${key}' should be object`);
    },
    FnErrValueShouldBeArray: function(key) {
        return new J2SError(100133, `the value of key '${key}' should be array`);
    },
    ErrRelationKeyConflicts: new J2SError(100134, `'replace' conflicts with 'add', 'remove' or 'create'`),
    FnErrUnknownRelationType: function(type) {
        return new J2SError(100135, `relation type '${type}' is not implemented`);
    },
    ErrNoQueryOrWhereSupplied: new J2SError(100136, `no 'query' or 'where' supplied in body when updating data`),
    ErrWhereKeywordWhenPutWithIdForbidden: new J2SError(100137, `the 'where' keyword is not allowed when put objects with id`),
    ErrWhereKeywordWhenDeleteWithIdForbidden: new J2SError(100138, `the 'where' keyword is not allowed when delete objects with id`),
    FnErrValueShouldBeNumberOrObject: function(key) {
        return new J2SError(100139, `the value of key '${key}' should be number or object`);
    },
}
