const { DataRouterBuilder } = require('./DataRouterBuilder');
const FastApiContext = require('fastapi-express').JSDOC.FastApiContext;
const getSchemaDBConnection = require('../db/SchemaDBConnector').getDBConnector;
const fs = require('fs');
const path = require('path');
const knex = require('knex').knex;
const uuid = require('uuid').v4;

class DataActionBuilder {
    /**
     * @param {DataRouterBuilder} router
     * @param {String} name
     * @param {String} description
     */
    constructor(router, name, description) {
        this.router = router;
        this.name = name;
        this.description = description;
        this.steps = [];
        this.fields = [];
        this.whereBuilder = null;
        this.withoutFields = [];
        this.cachePlan = null;
        this.cacheEnabled = false;
    }
    /** @param {function(FastApiContext){}} action */
    custom(action) {
        this.steps.push(action);
        return this;
    }
    without(...fields) {
        this.withoutFields = fields;
        return this;
    }
    cache(cachePlan) {
        if (!cachePlan) cachePlan = { ttl: 1800 };
        this.cachePlan = cachePlan;
        this.cacheEnabled = true;
        return this;
    }
    /**
    * @param {{path: string}} options
     */
    upload(options) {
        this.steps.push(async (ctx) => {
            var files = ctx.request.files;

            for (var file of files) {
                var filePath = path.join(options.path, file.id + path.extname(file.name));
                var fileStream = fs.createWriteStream(filePath);
                fileStream.write(file.base64Data);
                fileStream.end();
            }

            ctx.data_response = {
                file: file.name,
                path: filePath
            };
        });
        return this;
    }
    asFilter(...filters) {
        this.custom(async (ctx) => {
            var body = ctx.body;
            if (!body.filter) body.filter = {};
            for (var filter of filters) {
                if (typeof filter === 'string') {
                    body.filter[filter] = body[filter];
                }
                else {
                    for (var k in filter) {
                        var v = filter[k];
                        if (typeof v === 'function') {
                            v = v(body, k, body[k]);
                            if (v instanceof Promise) v = await v.catch(console.error);
                        }
                        body.filter[k] = v;
                    }
                }
            }
        });
        return this;
    }
    map(schema) {
        this.custom(async (ctx) => {
            var oldBody = ctx.body;
            var newBody = {};
            if (typeof schema === 'function') {
                newBody = schema(oldBody);
                if (newBody instanceof Promise) newBody = await newBody.catch(console.error);
            }
            else {
                for (var k in schema) {
                    var v = schema[k];
                    if (typeof v === "function") {
                        var result = v(oldBody, k);
                        if (result instanceof Promise) result = await result.catch(console.error);
                        newBody[k] = result;
                    }
                    else {
                        newBody[k] = oldBody[v];
                    }
                }
            }
            ctx.body = newBody;
        });
        return this;
    }
    mapResult(schema) {
        this.custom(async (ctx) => {
            var oldBody = ctx.data_response.data || {};
            if (!oldBody) return;

            var newBody = null;
            if (Array.isArray(oldBody)) {
                newBody = [];
                for (var item of oldBody) {
                    newBody.push(await MapObjectDynamic(item, schema, ctx));
                }
            }
            else {
                newBody = await MapObjectDynamic(oldBody, schema, ctx);
            }
            ctx.data_response.data = newBody;
        });
        return this;
    }
    /**
     * @param {String} name
     * @param {Function} queryFunc
     */
    field(name, queryFunc) {
        this.fields.push({ name, queryFunc });
        return this;
    }
    /**
     * @param {(db: knex)=>Promise<knex.QueryBuilder>} query}
     */
    where(query) {
        this.whereBuilder = query;
        return this;
    }
    /**
    * @param {String|Function} action
    */
    detail(action) {
        this.custom(async (ctx) => {
            var body = ctx.body;
            var recordId = body.Id || body.id;
            var tableName = this.router.name;
            var response = null;
            if (typeof action === 'function') {
                var result = action({ ctx, recordId, tableName });
                if (result instanceof Promise) result = await result.catch(console.error);
                response = result;
            }
            else {
                if (action !== null && action !== undefined) {
                    tableName = action;
                }
                /** @type {knex} */
                const db = await ctx.db(ctx);
                var dbSchema = this.router.builder.migration.getSchema(tableName);

                var query = db(tableName);
                query = query.limit(1);

                var pk = dbSchema.fields.filter(p => p.primary)[0];
                var whereCondition = null;

                if ((recordId || "").trim().length > 0) {
                    whereCondition = { [pk.name]: recordId };
                }

                var selectFields = ["*"];
                for (var field of this.fields) {
                    selectFields.push({ [field.name]: field.queryFunc(db) });
                }
                if (this.whereBuilder) {
                    query = this.whereBuilder(query, ctx);
                }
                if (whereCondition !== null) {
                    query = query.where(whereCondition);
                }
                response = await query.select(...selectFields).catch(console.error);
            }
            ctx.data_response = {
                success: response !== null && response !== undefined,
                data: response
            };
        });
        return this;
    }

    /**
     * @param {String|Function} action
     * action - Table name or Custom filter function
    */
    list(action) {
        this.custom(async (ctx) => {
            var body = ctx.body;
            var pagination = body && body.pagination;
            var sort = body && body.sort;
            var filter = body && body.filter;
            var searchText = body && body.search;
            var tableName = this.router.name;
            var response = null;
            if (typeof action === 'function') {
                var result = action({ ctx, sort, filter });
                if (result instanceof Promise) result = await result.catch(console.error);
                response = result;
            }
            else {
                if (action !== null && action !== undefined) {
                    tableName = action;
                }
                /** @type {knex} */
                const db = await ctx.db(ctx);
                var dbSchema = this.router.builder.migration.getSchema(tableName);

                var query = db(tableName);
                if (filter) {
                    for (var kv in filter) {
                        var v = filter[kv];
                        const field = dbSchema.fields.filter(f => f.name === kv)[0];
                        if (Array.isArray(v) && v.length > 0) {
                            if (field && field.type === "guid") {
                                query = query.whereIn(db.raw(`convert(nvarchar(MAX), ${kv})`), v);
                            }
                            else {
                                query = query.whereIn(kv, db.raw(v));
                            }
                        }
                        else {
                            if (field && field.type === "guid") {
                                query = query.where(db.raw(`convert(nvarchar(MAX), ${kv})`), v);
                            }
                            else {
                                query = BuildAdvancedFilter(query, kv, v);
                            }

                        }
                    }
                }
                if (this.whereBuilder) {
                    query = this.whereBuilder(query, ctx);
                }

                if (searchText !== undefined && searchText !== null && searchText.trim().length > 0) {
                    if (dbSchema) {
                        searchText = searchText.replace(/[\%]/g, "");
                        query = db().select().from({ t1: query.clone() });

                        var searchableFields = dbSchema.fields.filter(p => p.flags.indexOf("search") >= 0).map(p => p.name);
                        var unsearchableFields = dbSchema.fields.filter(p => p.flags.indexOf("unsearch") >= 0).map(p => p.name);
                        var searchFields = dbSchema.fields.filter(p => p.type === 'string').map(p => p.name);

                        searchFields = [...searchFields, ...searchableFields];
                        for (var f of searchFields) {
                            var fieldName = f;
                            if (unsearchableFields.indexOf(fieldName) > -1) {
                                continue;
                            }
                            query = query.orWhere(fieldName, 'like', `%${searchText}%`);
                        }
                    }
                }

                if (pagination) {
                    var countQuery = query.clone();
                    countQuery._statements = countQuery._statements.filter(p => p.grouping != "order");
                    pagination.count = await db.queryBuilder().from(countQuery.as('t1')).count('* as count').select().then(p => Number((p[0] || {}).count)).catch(console.error);

                    const pk = dbSchema.fields.filter(p => p.primary)[0];
                    if (pk) {
                        query = query.orderBy(pk.name, 'asc');
                    }

                    for (var field of dbSchema.fields.filter(p => p.flags.indexOf('ascending') > -1 || p.flags.indexOf('descending') > -1)) {
                        query = field.flags.indexOf('ascending') > -1 ? query = query.orderBy(field.name, 'asc') : query = query.orderBy(field.name, 'desc');
                    }

                    query = query.offset(pagination.page * pagination.itemCount).limit(pagination.itemCount);
                    pagination.pageCount = Math.ceil(pagination.count / (pagination.itemCount * 1.0));
                }
                else {
                    if (dbSchema) {
                        const pk = dbSchema.fields.filter(p => p.primary)[0];
                        if (pk) {
                            query = query.orderBy(pk.name, 'asc');
                        }

                        for (var field of dbSchema.fields.filter(p => p.flags.indexOf('ascending') > -1 || p.flags.indexOf('descending') > -1)) {
                            query = field.flags.indexOf('ascending') > -1 ? query = query.orderBy(field.name, 'asc') : query = query.orderBy(field.name, 'desc');
                        }
                    }
                }

                if (sort && sort.column) {
                    query = query.orderBy(sort.column, sort.state ? 'desc' : 'asc');
                }



                var selectFields = ["*"];
                for (var field of this.fields) {
                    selectFields.push({ [field.name]: field.queryFunc(db) });
                }
                response = await query.select(...selectFields).catch(console.error);
            }
            ctx.data_response = {
                success: response !== null && response !== undefined,
                pagination: pagination,
                data: response
            };
        });
        return this;
    }

    /**
     * @param {String|Function} action
     */
    create(action) {
        this.custom(async (ctx) => {
            var tableName = this.router.name;
            var response = null;
            var errors = [];

            if (action !== null && action !== undefined) {
                tableName = action;
            }
            /** @type {knex} */
            const db = await ctx.db(ctx);
            const schemaDBConnection = getSchemaDBConnection(db);

            if (typeof action === 'function') {
                var result = action({ ctx, db, tableName });
                if (result instanceof Promise) result = await result.catch(console.error);
                response = result;
            }
            else {
                var dbSchema = this.router.builder.migration.getSchema(tableName);

                var recordId = null;
                var record = { ...ctx.body };
                if (dbSchema) {
                    recordId = uuid();
                    var pk = dbSchema.fields.filter(p => p.primary)[0];
                    record[pk.name] = recordId;
                    var assignFields = dbSchema.fields.filter(p => p.assigns.length > 0 && p.assigns.filter(a => a.action === 'create').length > 0);
                    for (var field of assignFields) {
                        var assign = field.assigns.filter(p => p.action === "create")[0];
                        if (assign) {
                            try {
                                var fieldValue = assign.execute(schemaDBConnection);
                                if (fieldValue instanceof Promise) fieldValue = await fieldValue.catch(err => {
                                    errors.push({
                                        field: field.name,
                                        message: err.toString(),
                                        code: 'ASSIGN_ERROR'
                                    });
                                    console.error(err);
                                });
                                record[field.name] = fieldValue;
                            } catch (err) {
                                console.error(err);
                            }
                        }
                    }

                    var requiredFields = dbSchema.fields.filter(p => p.nullable !== true);
                    for (var reqField of requiredFields) {
                        if (record[reqField.name] === undefined) {
                            errors.push({
                                field: reqField.name,
                                message: `${reqField.name} is required`,
                                code: 'FIELD_REQUIRED'
                            });
                        }
                    }

                    if (errors.length === 0) {
                        await db(tableName).insert(record).then(p => {
                            response = recordId || true;
                        }).catch(err => {
                            errors.push({
                                field: '',
                                message: err.toString(),
                                code: 'DB_ERROR'
                            });
                            console.error(err);
                        });
                    }
                }

            }


            ctx.data_response = {
                success: (response !== null && response !== undefined) && errors.length === 0,
                errors: errors,
                data: response
            };
        });
        return this;
    }
    /**
   * @param {String|Function} action
   */
    update(action) {
        this.custom(async (ctx) => {
            var tableName = this.router.name;
            var response = null;
            var errors = [];

            if (action !== null && action !== undefined) {
                tableName = action;
            }
            /** @type {knex} */
            const db = await ctx.db(ctx);
            const schemaDBConnection = getSchemaDBConnection(db);


            if (typeof action === 'function') {
                var result = action({ ctx, db, tableName });
                if (result instanceof Promise) result = await result.catch(console.error);
                response = result;
            }
            else {
                var dbSchema = this.router.builder.migration.getSchema(tableName);

                var recordId = null;
                var record = { ...ctx.body };
                if (dbSchema) {
                    recordId = null;

                    var pk = dbSchema.fields.filter(p => p.primary)[0];
                    var whereCondition = null;

                    if ((record[pk.name] || "").trim().length > 0) {
                        recordId = record[pk.name];
                        delete record[pk.name];
                        whereCondition = { [pk.name]: recordId };
                    }

                    var assignFields = dbSchema.fields.filter(p => p.assigns.length > 0 && p.assigns.filter(a => a.action === 'update').length > 0);
                    for (var field of assignFields) {
                        var assign = field.assigns.filter(p => p.action === "update")[0];
                        if (assign) {
                            try {
                                var fieldValue = assign.execute(schemaDBConnection);
                                if (fieldValue instanceof Promise) fieldValue = await fieldValue.catch(err => {
                                    errors.push({
                                        field: field.name,
                                        message: err.toString(),
                                        code: 'ASSIGN_ERROR'
                                    });
                                    console.error(err);
                                });
                                record[field.name] = fieldValue;
                            } catch (err) {
                                console.error(err);
                            }
                        }
                    }

                    if (errors.length === 0 && whereCondition !== null) {
                        await db(tableName).where(whereCondition).update(record).then(p => {
                            response = recordId || true;
                        }).catch(err => {
                            errors.push({
                                field: '',
                                message: err.toString(),
                                code: 'DB_ERROR'
                            });
                            console.error(err);
                        });
                    } else {
                        if (whereCondition === null) {
                            errors.push({
                                field: pk.name,
                                message: `${pk.name} is required`,
                                code: 'FIELD_REQUIRED'
                            });
                        }
                    }
                }

            }


            ctx.data_response = {
                success: (response !== null && response !== undefined) && errors.length === 0,
                errors: errors,
                data: response
            };
        });
        return this;
    }
    /**
   * @param {String|Function} action
   */
    upsert(action) {
        this.custom(async (ctx) => {
            var tableName = this.router.name;
            var response = null;
            var errors = [];

            if (action !== null && action !== undefined) {
                tableName = action;
            }
            /** @type {knex} */
            const db = await ctx.db(ctx);
            const schemaDBConnection = getSchemaDBConnection(db);

            if (typeof action === 'function') {
                var result = action({ ctx, db, tableName });
                if (result instanceof Promise) result = await result.catch(console.error);
                response = result;
            }
            else {
                var dbSchema = this.router.builder.migration.getSchema(tableName);

                var recordId = null;
                var record = { ...ctx.body };
                if (dbSchema) {
                    recordId = null;

                    var pk = dbSchema.fields.filter(p => p.primary)[0];
                    var whereCondition = null;

                    if ((record[pk.name] || "").trim().length > 0) {
                        recordId = record[pk.name];
                        delete record[pk.name];
                        whereCondition = { [pk.name]: recordId };
                    }

                    var assignFields = dbSchema.fields.filter(p => p.assigns.length > 0 && p.assigns.filter(a => a.action === 'update').length > 0);
                    for (var field of assignFields) {
                        var assign = field.assigns.filter(p => p.action === "update")[0];
                        if (assign) {
                            try {
                                var fieldValue = assign.execute(schemaDBConnection);
                                if (fieldValue instanceof Promise) fieldValue = await fieldValue.catch(err => {
                                    errors.push({
                                        field: field.name,
                                        message: err.toString(),
                                        code: 'ASSIGN_ERROR'
                                    });
                                    console.error(err);
                                });
                                record[field.name] = fieldValue;
                            } catch (err) {
                                console.error(err);
                            }
                        }
                    }

                    if (errors.length === 0 && whereCondition !== null) {
                        await db(tableName).where(whereCondition).update(record).then(p => {
                            response = recordId || true;
                        }).catch(err => {
                            errors.push({
                                field: '',
                                message: err.toString(),
                                code: 'DB_ERROR'
                            });
                            console.error(err);
                        });
                    } else {
                        if (whereCondition === null) {
                            if (errors.length === 0) {
                                await db(tableName).insert(record).then(p => {
                                    response = recordId || true;
                                }).catch(err => {
                                    errors.push({
                                        field: '',
                                        message: err.toString(),
                                        code: 'DB_ERROR'
                                    });
                                    console.error(err);
                                });
                            }
                        }
                    }
                }

            }


            ctx.data_response = {
                success: (response !== null && response !== undefined) && errors.length === 0,
                errors: errors,
                data: response
            };
        });
        return this;
    }
    /**
   * @param {String|Function} action
   */
    delete(action) {
        this.custom(async (ctx) => {
            var tableName = this.router.name;
            var response = null;
            var errors = [];

            if (action !== null && action !== undefined) {
                tableName = action;
            }
            /** @type {knex} */
            const db = await ctx.db(ctx);
            const schemaDBConnection = getSchemaDBConnection(db);


            if (typeof action === 'function') {
                var result = action({ ctx, db, tableName });
                if (result instanceof Promise) result = await result.catch(console.error);
                response = result;
            }
            else {
                var dbSchema = this.router.builder.migration.getSchema(tableName);

                var recordId = null;
                var record = { ...ctx.body };
                var deletePermanently = false;
                if (dbSchema) {
                    recordId = null;

                    var pk = dbSchema.fields.filter(p => p.primary)[0];
                    var whereCondition = null;

                    if ((record[pk.name] || "").trim().length > 0) {
                        recordId = record[pk.name];
                        delete record[pk.name];
                        whereCondition = { [pk.name]: recordId };
                    }

                    var isDeletedField = dbSchema.fields.filter(p => p.name == "IsDeleted" || p.name == "isDeleted" || p.name == "is_deleted")[0];
                    if (isDeletedField) {
                        record[isDeletedField.name] = true;
                        deletePermanently = false;
                    }
                    else {
                        deletePermanently = true;
                    }

                    var assignFields = dbSchema.fields.filter(p => p.assigns.length > 0 && p.assigns.filter(a => a.action === 'delete').length > 0);
                    for (var field of assignFields) {
                        var assign = field.assigns.filter(p => p.action === "delete")[0];
                        if (assign) {
                            try {
                                var fieldValue = assign.execute(schemaDBConnection);
                                if (fieldValue instanceof Promise) fieldValue = await fieldValue.catch(err => {
                                    errors.push({
                                        field: field.name,
                                        message: err.toString(),
                                        code: 'ASSIGN_ERROR'
                                    });
                                    console.error(err);
                                });
                                record[field.name] = fieldValue;
                            } catch (err) {
                                console.error(err);
                            }
                        }
                    }

                    if (errors.length === 0 && whereCondition !== null) {
                        if (deletePermanently) {
                            await db(tableName).where(whereCondition).delete(record).then(p => {
                                response = recordId || true;
                            }).catch(err => {
                                errors.push({
                                    field: '',
                                    message: err.toString(),
                                    code: 'DB_ERROR'
                                });
                                console.error(err);
                            });
                        }
                        else {
                            await db(tableName).where(whereCondition).update(record).then(p => {
                                response = recordId || true;
                            }).catch(err => {
                                errors.push({
                                    field: '',
                                    message: err.toString(),
                                    code: 'DB_ERROR'
                                });
                                console.error(err);
                            });
                        }
                    } else {
                        if (whereCondition === null) {
                            errors.push({
                                field: pk.name,
                                message: `${pk.name} is required`,
                                code: 'FIELD_REQUIRED'
                            });
                        }
                    }
                }

            }


            ctx.data_response = {
                success: (response !== null && response !== undefined) && errors.length === 0,
                errors: errors,
                data: response
            };
        });
        return this;
    }
    /**
     * @param {String|Function} action
     */
    setState(action) {
        this.custom(async (ctx) => {
            var tableName = this.router.name;
            var response = null;
            var errors = [];

            if (action !== null && action !== undefined) {
                tableName = action;
            }
            /** @type {knex} */
            const db = await ctx.db(ctx);
            const schemaDBConnection = getSchemaDBConnection(db);


            if (typeof action === 'function') {
                var result = action({ ctx, db, tableName });
                if (result instanceof Promise) result = await result.catch(console.error);
                response = result;
            }
            else {
                var dbSchema = this.router.builder.migration.getSchema(tableName);

                var recordId = null;
                var record = {};
                if (dbSchema) {
                    recordId = null;

                    var pk = dbSchema.fields.filter(p => p.primary)[0];
                    var whereCondition = null;

                    if ((ctx.body[pk.name] || "").trim().length > 0) {
                        recordId = ctx.body[pk.name];
                        whereCondition = { [pk.name]: recordId };
                    }

                    var isActiveField = dbSchema.fields.filter(p => p.name == "IsActive" || p.name == "isactive" || p.name == "isActive")[0];

                    var assignFields = dbSchema.fields.filter(p => p.assigns.length > 0 && p.assigns.filter(a => a.action === 'setstate').length > 0);
                    for (var field of assignFields) {
                        var assign = field.assigns.filter(p => p.action === "setstate")[0];
                        if (assign) {
                            try {
                                var fieldValue = assign.execute(schemaDBConnection);
                                if (fieldValue instanceof Promise) fieldValue = await fieldValue.catch(err => {
                                    errors.push({
                                        field: field.name,
                                        message: err.toString(),
                                        code: 'SETSTATE_ERROR'
                                    });
                                    console.error(err);
                                });
                                record[field.name] = fieldValue;
                            } catch (err) {
                                console.error(err);
                            }
                        }
                    }

                    if (errors.length === 0 && whereCondition !== null) {

                        var recordDetailList = await db(tableName).where(whereCondition).limit(1).select().catch(console.error);
                        if (isActiveField) {
                            if (recordDetailList.length === 0) {
                                errors.push({
                                    field: "",
                                    message: "Record not found",
                                    code: 'RECORD_NOTFOUND'
                                });
                            }
                        }
                        else {
                            errors.push({
                                field: '',
                                message: "State field not defined",
                                code: 'FIELD_NOT_DEFINED'
                            });
                        }

                        if (errors.length === 0) {
                            await db(tableName).where(whereCondition).update({
                                [isActiveField.name]: ctx.body.value
                            }).then(() => {
                                response = {
                                    old: !record[isActiveField.name],
                                    new: record[isActiveField.name]
                                };
                            }).catch(err => {
                                errors.push({
                                    field: '',
                                    message: err.toString(),
                                    code: 'DB_ERROR'
                                });
                                console.error(err);
                            });
                        }
                    } else {
                        if (whereCondition === null) {
                            errors.push({
                                field: pk.name,
                                message: `${pk.name} is required`,
                                code: 'FIELD_REQUIRED'
                            });
                        }
                    }
                }

            }


            ctx.data_response = {
                success: (response !== null && response !== undefined) && errors.length === 0,
                errors: errors,
                data: response
            };
        });
        return this;
    }
    /**
     * @param {String|Function} action
     */
    storedProcedureJSON(action, disableParseResults = false) {
        this.custom(async (ctx) => {
            var tableName = this.router.name;
            var response = null;
            var errors = [];

            if (action !== null && action !== undefined) {
                tableName = action;
            }
            /** @type {knex} */
            const db = await ctx.db(ctx);

            if (typeof action === 'function') {
                var result = action({ ctx, db, tableName });
                if (result instanceof Promise) result = await result.catch(console.error);
                response = result;
            }
            else {

                var record = { ...ctx.body };

                if (errors.length === 0) {

                    await db.raw(`exec ${tableName} ?`, [
                        JSON.stringify(record)
                    ]).then(records => {
                        if (disableParseResults) return response = records;
                        try {
                            if (records) {
                                response = JSON.parse(
                                    records
                                        .map((r) => {
                                            return Object.values(r)[0];
                                        })
                                        .join("")
                                );
                            }
                        } catch (err) {
                            console.error(err);
                            return null;
                        }
                    }).catch((err) => {
                        errors.push({
                            field: '',
                            message: err.toString(),
                            code: 'DB_ERROR'
                        });
                        console.error(err);
                    });
                }
            }

            ctx.data_response = {
                success: (response !== null && response !== undefined) && errors.length === 0,
                errors: errors,
                data: response
            };
        });
        return this;
    }
}

async function MapObjectDynamic(oldbody, schema, ctx) {
    if (typeof schema == 'function') {
        var result = schema(oldbody, ctx);
        if (result instanceof Promise) result = await result.catch(console.error);
        return result;
    }

    var newBody = {};
    for (var k in schema) {
        var v = schema[k];
        if (typeof v === "function") {
            var result = v(oldBody, k, ctx);
            if (result instanceof Promise) result = await result.catch(console.error);
            newBody[k] = result;
        }
        else {
            newBody[k] = oldBody[v];
        }
    }
    return newBody;
}

function BuildAdvancedFilter(query, key, value) {
    if (typeof value == 'object') {
        var exit = false;
        if (value.hasOwnProperty('gt')) {
            query = query.where(key, '>', value.gt);
        }
        if (value.hasOwnProperty('lt')) {
            query = query.where(key, '<', value.lt);
        }
        if (value.hasOwnProperty('gte')) {
            query = query.where(key, '>=', value.gte);
        }
        if (value.hasOwnProperty('lte')) {
            query = query.where(key, '<=', value.lte);
        }
        if (value.hasOwnProperty('eq')) {
            query = query.where(key, value.eq);
        }
        if (value.hasOwnProperty('neq')) {
            query = query.whereNot(key, value.neq);
        }
        if (value.hasOwnProperty('from')) {
            query = query.where(key, '>=', value.from);
            exit = true;
        }
        if (value.hasOwnProperty('to')) {
            query = query.where(key, '<', value.to);
            exit = true;
        }
        if (value.hasOwnProperty('in')) {
            query = query.whereIn(key, value.in);
            exit = true;
        }
    }
    if (!exit) {
        return query.where(key, value);
    }
    else {
        return query;
    }
}

module.exports = { DataActionBuilder };