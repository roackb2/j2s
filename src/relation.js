'use strict';

import isPlainObject from 'lodash/isPlainObject';
import isArray from 'lodash/isArray';
import isNumber from 'lodash/isNumber';
import pickBy from 'lodash/pickBy';
import every from 'lodash/every';
import has from 'lodash/has';
import map from 'lodash/map';
import * as errors from './errors';
import Promise from 'bluebird';
import {check, query} from './core';

export function getRelationNames(bookshelf, instance, model) {
    let names = [];
    for (let name of Object.getOwnPropertyNames(Object.getPrototypeOf(instance))) {
        let method = instance[name];
        if (!(method instanceof Function) || method === model) continue;
        names.push(name)
    }
    return names
}

// TODO: access control on relations
export async function modifyRelation(ctx, bookshelf, instance, model, relationName, payload, transacting, allOpts) {
    let relation = instance[relationName]();
    let relatedData = relation.relatedData;
    let relationType = relatedData.type;
    let foreignKey = relatedData.foreignKey;
    let targetIdAttribute = relatedData.targetIdAttribute;
    let targetModel = relatedData.target;
    let parentIdAttribute = instance.get(instance.idAttribute)
    let relationOpts = null;
    for (var key in allOpts) {
        if (allOpts[key].model == targetModel) {
            relationOpts = allOpts[key]
            break
        }
    }
    if (relationType === 'hasOne' || relationType === 'morphOne') {
        if (isNumber(payload)) {
            let relInstance = await targetModel.where({
                [targetIdAttribute]: payload
            }).save({
                [foreignKey]: parentIdAttribute
            }, {
                transacting: transacting,
                method: 'update',
                patch: true,
                require: true,
            });
            // relation modification is on target model,
            // check whether user has target model update permission
            let checked = await check(ctx, relationOpts.identity.U, relationOpts.admin.U, relInstance, relationOpts.access.U);
            if (!checked) {
                throw errors.ErrOperationNotAuthorized;
            }
        } else if (isPlainObject(payload)) {
            payload[foreignKey] = parentIdAttribute;
            let relInstance = await targetModel.forge(payload).save(null, {
                transacting: transacting,
                method: 'insert'
            });
            // relation modification is on target model,
            // check whether user has target model creation permission
            let checked = await check(ctx, relationOpts.identity.C, relationOpts.admin.C, relInstance, relationOpts.access.C);
            if (!checked) {
                throw errors.ErrOperationNotAuthorized;
            }
        } else {
            throw errors.FnErrValueShouldBeNumberOrObject(relationName);
        }
    } else if (relationType === 'belongsTo' || relationType === 'morphTo') {
        let foreignAttribute = null;
        if (isNumber(payload)) {
            foreignAttribute = payload;
        } else if (isPlainObject(payload)) {
            let foreignInstance = await targetModel.forge(payload).save(null, {
                transacting: transacting,
                method: 'insert',
            })
            // given plain object, user intend to create a foreign model instance,
            // check whether user has target model update permission
            let checked = await check(ctx, relationOpts.identity.C, relationOpts.admin.C, foreignInstance, relationOpts.access.C);
            if (!checked) {
                throw errors.ErrOperationNotAuthorized;
            }
            foreignAttribute = foreignInstance.get(foreignInstance.idAttribute);
        } else {
            throw errors.FnErrValueShouldBeNumberOrObject(relationName);
        }
        // a belongsTo relation field is on current instance, no need to check again
        await instance.save({
            [foreignKey]: foreignAttribute
        }, {
            transacting: transacting,
            method: 'update',
            patch: true,
            require: true,
        });
    } else if (relationType === 'hasMany' || relationType === 'morphMany') {
        if (!isPlainObject(payload)) {
            throw errors.FnErrValueShouldBeObject(relationName);
        }
        if (has(payload, 'add')) {
            if (!isArray(payload.add)) {
                throw errors.FnErrValueShouldBeArray('add');
            }
            let foreignInstances = []
            for (let i = 0; i < payload.add.length; i++) {
                let id = payload.add[i];
                let inst = await targetModel.where({
                    [targetIdAttribute]: id
                }).save({
                    [foreignKey]: parentIdAttribute
                }, {
                    transacting: transacting,
                    method: 'update',
                    patch: true,
                    require: true,
                })
                foreignInstances.push(inst)
            }
            // relation modification is on target model,
            // check whether user has target model update permission
            let checked = await check(ctx, relationOpts.identity.U, relationOpts.admin.U, foreignInstances, relationOpts.access.U);
            if (!checked) {
                throw errors.ErrOperationNotAuthorized;
            }
        }
        if (has(payload, 'remove')) {
            if (!isArray(payload.remove)) {
                throw errors.FnErrValueShouldBeArray('remove');
            }
            let foreignInstances = [];
            for (let i = 0; i < payload.remove.length; i++) {
                let id = payload.remove[i];
                let inst = await targetModel.where({
                    [targetIdAttribute]: id
                }).save({
                    [foreignKey]: null
                }, {
                    transacting: transacting,
                    method: 'update',
                    patch: true,
                    require: true,
                })
                foreignInstances.push(inst)
            }
            // relation modification is on target model,
            // check whether user has target model update permission
            let checked = await check(ctx, relationOpts.identity.U, relationOpts.admin.U, foreignInstances, relationOpts.access.U);
            if (!checked) {
                throw errors.ErrOperationNotAuthorized;
            }
        }
        if (has(payload, 'create')) {
            if (!isArray(payload.create)) {
                throw errors.FnErrValueShouldBeArray('create');
            }
            let foreignInstances = await Promise.map(payload.create, obj => {
                return relation.create(obj, {
                    transacting: transacting
                })
            })
            // relation modification is on target model,
            // check whether user has target model create permission
            let checked = await check(ctx, relationOpts.identity.C, relationOpts.admin.C, foreignInstances, relationOpts.access.C);
            if (!checked) {
                throw errors.ErrOperationNotAuthorized;
            }
        }
        if (has(payload, 'replace')) {
            if (has(payload, 'add') || has(payload, 'remove') || has(payload, 'create')) {
                throw errors.ErrRelationKeyConflicts;
            }
            if (!isArray(payload.replace)) {
                throw errors.FnErrValueShouldBeArray('replace');
            }
            let foreignInstances = await relation.fetch()
            await foreignInstances.invokeThen('save', {
                [foreignKey]: null
            }, {
                transacting: transacting,
                method: 'update',
                patch: true,
                require: true,
            });
            for (let i = 0; i < payload.replace.length; i++) {
                let id = payload.replace[i];
                let inst =  await targetModel.where({
                    [targetIdAttribute]: id
                }).save({
                    [foreignKey]: parentIdAttribute
                }, {
                    transacting: transacting,
                    method: 'update',
                    patch: true,
                    require: true,
                })
                foreignInstances.push(inst);
            }
            // relation modification is on target model,
            // check whether user has target model update permission
            let checked = await check(ctx, relationOpts.identity.U, relationOpts.admin.U, foreignInstances, relationOpts.access.U);
            if (!checked) {
                throw errors.ErrOperationNotAuthorized;
            }
        }
    } else if (relationType === 'belongsToMany') {
        let joinTableOpts = null;
        for (key in allOpts) {
            if (allOpts[key].tableName == relatedData.joinTableName) {
                joinTableOpts = allOpts[key];
                break;
            }
        }
        let joinModel = joinTableOpts.model;
        if (!isPlainObject(payload)) {
            throw errors.FnErrValueShouldBeNumberOrObject(relationName);
        }
        if (has(payload, 'add')) {
            if (!isArray(payload.add)) {
                throw errors.FnErrValueShouldBeArray('add');
            }
            let relationPayload = map(payload.add, function(id) {
                return {
                    [relatedData.otherKey]: id,
                    [relatedData.foreignKey]: instance.get(relatedData.parentIdAttribute)
                }
            })
            let relationInstances = await Promise.map(relationPayload, function(payload) {
                return joinModel.forge(payload).save(null, {
                    transacting: transacting,
                    method: 'insert',
                    patch: false,
                    require: true,
                })
            })
            // relation modification is on joining model,
            // check whether user has joining model create permission
            let checked = await check(ctx, joinTableOpts.identity.C, joinTableOpts.admin.C, relationInstances, joinTableOpts.access.C);
            if (!checked) {
                throw errors.ErrOperationNotAuthorized;
            }
        }
        if (has(payload, 'remove')) {
            if (!isArray(payload.remove)) {
                throw errors.FnErrValueShouldBeArray('remove');
            }
            let relationInstances = await joinModel.query(function(qb) {
                qb.where({
                    [relatedData.foreignKey]: instance.get(relatedData.parentIdAttribute)
                }).whereIn(relatedData.otherKey, payload.remove)
            }).fetchAll()
            if (relationInstances.length == 0) {
                throw errors.ErrResourceNotFound
            }
            // relation modification is on joining model,
            // check whether user has joining model deletion permission
            let checked = await check(ctx, joinTableOpts.identity.D, joinTableOpts.admin.D, relationInstances, joinTableOpts.access.D);
            if (!checked) {
                throw errors.ErrOperationNotAuthorized;
            }
            await relationInstances.invokeThen('destroy', {
                transacting: transacting
            })
        }
        if (has(payload, 'create')) {
            if (!isArray(payload.create)) {
                throw errors.FnErrValueShouldBeArray('create');
            }
            let foreignInstances = await Promise.map(payload.create, obj => {
                return relation.create(obj, {
                    transacting: transacting
                })
            })
            // only check target model creation permission
            let checked = await check(ctx, relationOpts.identity.C, relationOpts.admin.C, foreignInstances, relationOpts.access.C);
            if (!checked) {
                throw errors.ErrOperationNotAuthorized;
            }
        }
        if (has(payload, 'replace')) {
            if (has(payload, 'add') || has(payload, 'remove') || has(payload, 'create')) {
                throw errors.ErrRelationKeyConflicts;
            }
            if (!isArray(payload.replace)) {
                throw errors.FnErrValueShouldBeArray('replace');
            }

            let relationInstances = await joinModel.query(function(qb) {
                qb.where({
                    [relatedData.foreignKey]: instance.get(relatedData.parentIdAttribute)
                })
            }).fetchAll()
            // relation modification is on joining model,
            // check whether user has joining model deletion permission
            let checked = await check(ctx, joinTableOpts.identity.D, joinTableOpts.admin.D, relationInstances, joinTableOpts.access.D);
            if (!checked) {
                throw errors.ErrOperationNotAuthorized;
            }
            await relationInstances.invokeThen('destroy', {
                transacting: transacting
            })
            let relationPayload = null;
            if (every(payload.replace, isPlainObject)) {
                relationPayload = payload.replace
            } else {
                relationPayload = map(payload.replace, function(id) {
                    return {
                        [relatedData.otherKey]: id,
                        [relatedData.foreignKey]: instance.get(relatedData.parentIdAttribute)
                    }
                })
            }
            relationInstances = await Promise.map(relationPayload, function(payload) {
                return joinModel.forge(payload).save(null, {
                    transacting: transacting,
                    method: 'insert',
                    patch: false,
                    require: true,
                })
            })
            // relation modification is on joining model,
            // check whether user has joining model create permission
            checked = await check(ctx, joinTableOpts.identity.C, joinTableOpts.admin.C, relationInstances, joinTableOpts.access.C);
            if (!checked) {
                throw errors.ErrOperationNotAuthorized;
            }
        }
    } else {
        throw errors.FnErrUnknownRelationType(relationType);
    }
}
