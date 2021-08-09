const FastApiRouter = require('fastapi-express').FastApiRouter;
const FastApiContext = FastApiRouter.FastApiContext;
const migration = require('./migration');
const dbConnection = require('./databaseConnection');
const getSchemaDBConnection = require('./SchemaDBConnector').getDBConnector;
const fs = require('fs');
const path = require('path');
const knex = require('knex').knex;
const EntityManager = require('fastapi-express').KnexEntityPlugin.EntityManager;
const uuid = require('uuid').v4;
class DataRestBuilder {
    constructor() {
        /** @type {DataRouterBuilder[]} */
        this.routers = [];
    }
    /**
     * @param {knex} db
     * @param {string} schemaPath
     */
    init(db, schemaPath) {
        this.schemaPath = schemaPath;
        this.db = db;
        if (db) {
            this.migration = new migration(new dbConnection(db));
            if (schemaPath && fs.existsSync(schemaPath)) this.migration.registerSchemas(schemaPath);
        }
    }
    async exportSchemas() {
        if (this.migration) {
            await this.migration.exportSchemas(this.schemaPath);
        }
    }
    /**
     * @param {String} name
     * @returns {DataRouterBuilder}
     */
    router(name) {
        var routerBuilder = new DataRouterBuilder(this, name);
        this.routers.push(routerBuilder);
        return routerBuilder;
    }
    build(app, routerPath) {
        this.app = app;
        for (var file of fs.readdirSync(routerPath, { withFileTypes: true })) {
            var f = path.join(routerPath, file.name);
            if (file.name.endsWith(".datarouter.js")) {
                require(f).init(this);
            }
        }

        for (var router of this.routers) {
            router.router.init(app);
            app.app.use("/api/" + router.name, router.router.router);
        }
    }
}

class DataRouterBuilder {
    /**
     * @param {DataRestBuilder} builder
     * @param {String} name
     */
    constructor(builder, name) {
        this.builder = builder;
        this.name = name;
        this.actions = [];
        this.router = new FastApiRouter.FastApiRouter(this.name, false);
    }
    /** 
     * @param {String} name
     * @param {String} description
     * @return {DataActionBuilder}
    */
    action(name, description) {
        var actionBuilder = new DataActionBuilder(this, name, description);
        this.actions.push(actionBuilder);
        this.router.post(name, (async (actionBuilder, ctx) => {
            const steps = actionBuilder.steps;
            for (var step of steps) {
                var r = step(ctx);
                if (r instanceof Promise) r = await r.catch(console.error);
            }
            return ctx.data_response;
        }).bind(this, actionBuilder));
        return actionBuilder;
    }
    /**
     * @param {String} sourceName
     * @param {String} name
     * @param {String} description
     * @return {DataActionBuilder}
     */
    cloneAction(sourceName, name, description) {
        var sourceAction = this.actions.find(a => a.name == sourceName);
        if (sourceAction) {
            var actionBuilder = new DataActionBuilder(this, name, description);
            actionBuilder.steps = sourceAction.steps;
            actionBuilder.fields = sourceAction.fields;
            this.actions.push(actionBuilder);
            this.router.post(name, (async (actionBuilder, ctx) => {
                console.log(Object.keys(ctx));
                const steps = actionBuilder.steps;
                for (var step of steps) {
                    var r = step(ctx);
                    if (r instanceof Promise) r = await r.catch(console.error);
                }
                return ctx.data_response;
            }).bind(this, actionBuilder));
            return actionBuilder;
        }
        return null;
    }
}

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
    }
    newStep(action) {
        this.steps.push(action);
        return this;
    }
    asFilter(...filters){
        this.newStep(async (ctx) => {
            var body = ctx.body;
            if(!body.filter) body.filter = {};
            for(var filter of filters){
                body.filter[filter] = body[filter];
            }
        });
        return this;
    }
    map(schema) {
        this.newStep(async (ctx) => {
            var oldBody = ctx.body;
            var newBody = {};
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
            ctx.body = newBody;
        });
        return this;
    }
    mapResult(schema) {
        this.newStep(async (ctx) => {
            var oldBody = ctx.data_response.data || {};
            if (!oldBody) return;

            var newBody = null;
            if (Array.isArray(oldBody)) {
                newBody = [];
                for (var item of oldBody) {
                    newBody.push(await MapObjectDynamic(item, schema));
                }
            }
            else {
                newBody = await MapObjectDynamic(oldBody, schema);
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
    * @param {String|Function} action
    */
    detail(action) {
        this.newStep(async (ctx) => {
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
                dbSchema.fields.filter(p => p.primary)[0]

                var query = db(tableName);
                query = query.limit(1);

                var pk = dbSchema.fields.filter(p => p.primary)[0];
                var whereCondition = null;

                if ((record[pk.name] || "").trim().length > 0) {
                    whereCondition = { [pk.name]: recordId };
                }

                var selectFields = ["*"];
                for (var field of this.fields) {
                    selectFields.push({ [field.name]: field.queryFunc(db) });
                }
                response = await query.where(whereCondition).select(...selectFields).catch(console.error);
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
        this.newStep(async (ctx) => {
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
                        query = query.where(kv, v);
                    }
                }
                if (searchText) {
                    for (var f of dbSchema.fields.filter(p => p.type === 'string')) {
                        var fieldName = f.name;
                        query = query.where(fieldName, 'like', `%${searchText}%`);
                    }
                }

                if (sort) {
                    query = query.orderBy(sort.column, sort.state ? 'desc' : 'asc');
                }

                if (pagination) {
                    query = query.offset(pagination.page * pagination.itemCount).limit(pagination.itemCount);
                    pagination.count = await query.count('* as count').then(p => new Number((p[0] || {}).count)).catch(console.error);
                    pagination.pageCount = Math.ceil(pagination.count / (pagination.itemCount * 1.0));
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
        this.newStep(async (ctx) => {
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
        this.newStep(async (ctx) => {
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
    delete(action) {
        this.newStep(async (ctx) => {
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
        this.newStep(async (ctx) => {
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

                        var recordDetailList = await db(tableName).where(whereCondition).limit(1).select().catch(console.error);
                        if (isActiveField) {
                            if (recordDetailList.length > 0) {
                                record[isActiveField.name] = !recordDetailList[0][isActiveField.name];
                            }
                            else {
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
    storedProcedureJSON(action) {
        this.newStep(async (ctx) => {
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

                var recordId = null;
                var record = { ...ctx.body };

                if (errors.length === 0) {

                    await db.raw(`exec ${tableName} ?`, [
                        JSON.stringify(record)
                    ]).then(records => {
                        response = JSON.parse(records.map(r => {
                            return r[Object.keys(r)[0]];
                        }).join(""));
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

async function MapObjectDynamic(oldbody, schema) {
    if (typeof schema == 'function') {
        var result = schema(oldbody);
        if (result instanceof Promise) result = await result.catch(console.error);
        return result;
    }

    var newBody = {};
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
    return newBody;
}

module.exports = {
    DataRestBuilder
};