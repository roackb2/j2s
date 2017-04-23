'use strict';

import isPlainObject from 'lodash/isPlainObject';
import isArray from 'lodash/isArray';
import isNumber from 'lodash/isNumber';
import has from 'lodash/has';
import * as errors from './errors';
import Promise from 'bluebird';

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
export async function modifyRelation(bookshelf, instance, model, relationName, payload, transacting) {
    let relation = instance[relationName]();
    let relatedData = relation.relatedData;
    let relationType = relatedData.type;
    let foreignKey = relatedData.foreignKey;
    let targetIdAttribute = relatedData.targetIdAttribute;
    let targetModel = relatedData.target;
    let parentIdAttribute = instance.get(instance.idAttribute)
    if (relationType === 'hasOne' || relationType === 'morphOne') {
        if (isNumber(payload)) {
            await targetModel.where({
                [targetIdAttribute]: payload
            }).save({
                [foreignKey]: parentIdAttribute
            }, {
                transacting: transacting,
                method: 'update',
                patch: true,
                require: true,
            });
        } else if (isPlainObject(payload)) {
            payload[foreignKey] = parentIdAttribute;
            await targetModel.forge(payload).save(null, {
                transacting: transacting,
                method: 'insert'
            });
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
            foreignAttribute = foreignInstance.get(foreignInstance.idAttribute);
        } else {
            throw errors.FnErrValueShouldBeNumberOrObject(relationName);
        }
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
            for (let i = 0; i < payload.add.length; i++) {
                let id = payload.add[i];
                await targetModel.where({
                    [targetIdAttribute]: id
                }).save({
                    [foreignKey]: parentIdAttribute
                }, {
                    transacting: transacting,
                    method: 'update',
                    patch: true,
                    require: true,
                })
            }
        }
        if (has(payload, 'remove')) {
            if (!isArray(payload.remove)) {
                throw errors.FnErrValueShouldBeArray('remove');
            }
            for (let i = 0; i < payload.remove.length; i++) {
                let id = payload.remove[i];
                await targetModel.where({
                    [targetIdAttribute]: id
                }).save({
                    [foreignKey]: null
                }, {
                    transacting: transacting,
                    method: 'update',
                    patch: true,
                    require: true,
                })
            }
        }
        if (has(payload, 'create')) {
            if (!isArray(payload.create)) {
                throw errors.FnErrValueShouldBeArray('create');
            }
            await Promise.map(payload.create, obj => {
                return relation.create(obj, {
                    transacting: transacting
                })
            })
        }
        if (has(payload, 'replace')) {
            if (has(payload, 'add') || has(payload, 'remove') || has(payload, 'create')) {
                throw errors.ErrRelationKeyConflicts;
            }
            if (!isArray(payload.replace)) {
                throw errors.FnErrValueShouldBeArray('replace');
            }
            await relation.fetch().save({
                [foreignKey]: null
            }, {
                transacting: transacting,
                method: 'update',
                patch: true,
                require: true,
            });
            for (let i = 0; i < payload.replace.length; i++) {
                let id = payload.replace[i];
                await targetModel.where({
                    [targetIdAttribute]: id
                }).save({
                    [foreignKey]: parentIdAttribute
                }, {
                    transacting: transacting,
                    method: 'update',
                    patch: true,
                    require: true,
                })
            }
        }
    } else if (relationType === 'belongsToMany') {
        if (!isPlainObject(payload)) {
            throw errors.FnErrValueShouldBeNumberOrObject(relationName);
        }
        if (has(payload, 'add')) {
            if (!isArray(payload.add)) {
                throw errors.FnErrValueShouldBeArray('add');
            }
            await relation.attach(payload.add, {
                transacting: transacting
            })
        }
        if (has(payload, 'remove')) {
            if (!isArray(payload.remove)) {
                throw errors.FnErrValueShouldBeArray('remove');
            }
            await relation.detach(payload.remove, {
                transacting: transacting
            })
        }
        if (has(payload, 'create')) {
            if (!isArray(payload.create)) {
                throw errors.FnErrValueShouldBeArray('create');
            }
            await Promise.map(payload.create, obj => {
                return relation.create(obj, {
                    transacting: transacting
                })
            })
        }
        if (has(payload, 'replace')) {
            if (has(payload, 'add') || has(payload, 'remove') || has(payload, 'create')) {
                throw errors.ErrRelationKeyConflicts;
            }
            if (!isArray(payload.replace)) {
                throw errors.FnErrValueShouldBeArray('replace');
            }
            await relation.detach(null, {
                transacting: transacting
            })
            await relation.attach(payload.replace, {
                transacting: transacting
            })
        }
    } else {
        throw errors.FnErrUnknownRelationType(relationType);
    }
}
