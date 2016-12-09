'use strict';

const _ = require('lodash');
const util = require('util');

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
    ErrBetweenSuffixValueShouldBeList: new J2SError(100101, 'value for query clause with `between` suffix must be list'),
    ErrBetweenSuffixValueShouldBeLengthTwo: new J2SError(100102, 'value for query clause with `between` suffix must be list of length 2'),
    ErrNotBetweenSuffixShouldBeList: new J2SError(100103, 'value for query clause with `not_between` suffix must be list'),
    ErrNotBetweenSuffixShouldBeLengthTwo: new J2SError(100104, 'value for query clause with `not_between` suffix must be list of length 2'),
    ErrInSuffixShouldBeList: new J2SError(100105, 'value for query clause with `in` suffix must be list'),
    ErrNotInSuffixShouldBeList: new J2SError(100106, 'value for query clause with `not_in` suffix must be list'),
    ErrNullSuffixShouldBeBoolean: new J2SError(100107, 'value for query clause with `null` suffix must be boolean'),
    FnErrSuffixNotImplemented: function(suffix) {
        return new J2SError(100108, util.format('suffix `%s` is not implemented', suffix));
    },
    ErrJoinShouldBeJSONObject: new J2SError(100108, 'value of `join` should be JSON object'),
    ErrOrderByShouldBeList: new J2SError(100109, 'value of `order_by` should be list'),
    ErrOrderByLengthShouldBeTwo: new J2SError(100110, 'value of `order_by` could only be of length 1 or 2'),
    FnErrKeywordNotImplemented: function(keyword) {
        return new J2SError(100111, util.format('keyword `%s` is not implemented', key));
    },
    FnErrUnknowRuleType: function(rule) {
        return new J2SError(100112, util.format('unknown rule type: %s', rule));
    },
    ErrOperationNotAuthorized: new J2SError(100113, 'operation not authorized'),
    ErrQueryShouldBeJsonObject: new J2SError(100115, 'value of `query` must be JSON object'),
    ErrDataShouldBeJsonObject: new J2SError(100117, 'value of `data` must be JSON object'),
    ErrPopulateShouldBeList: new J2SError(100118, 'value of `populate` must be JSON array'),
    ErrPopulateObjectShouldHaveExactlyOneKey: new J2SError(100119, 'value of element in `populate` with object type should have exactly one key'),
    ErrPopulateElementShouldBeStringOrObject: new J2SError(100120, 'value of element in `populate` should be either JSON object or string'),
    ErrExistsObjectShouldHaveExactlyOneKey: new J2SError(100121, 'value of `exists` or `not_exists` should be JSON object that contains exactly one key'),
    ErrExtraShouldBeList: new J2SError(100122, 'value of `extra` should be JSON Array'),
    FnErrKeyForbidden: function(keyword) {
        return new J2SError(100123, util.format('keyword `%s` is forbidden', keyword));
    },
    ErrAddClauseElementShouldBeStringOrObject: new J2SError(100124, 'value of element in `add_clause` should be either JSON object or string'),
}
