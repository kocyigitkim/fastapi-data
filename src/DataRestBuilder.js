const FastApiRouter = require('fastapi-express').FastApiRouter;
const FastApiContext = FastApiRouter.FastApiContext;
const migration = require('./migration');
const fs = require('fs');
const path = require('path');
const knex = require('knex').knex;
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
        if (db) {
            this.migration = new migration(db);
            if (schemaPath && fs.existsSync(schemaPath)) this.migration.registerSchemas(schemaPath);
        }
    }
    /**
     * @param {String} name
     * @returns {DataRouterBuilder}
     */
    router(name) {
        var routerBuilder = new DataRouterBuilder(name);
        this.routers.push(routerBuilder);
        return routerBuilder;
    }
    build(app, routerPath) {

        for (var file of fs.readdirSync(routerPath, { withFileTypes: true })) {
            var f = path.join(routerPath, file.name);
            if (file.name.endsWith(".datarouter.js")) {
                require(f).init(this);
            }
        }

        for (var router of this.routers) {
            app.app.use("/api/" + router.name, router.router.router);
        }
    }
}

class DataRouterBuilder {
    constructor(name) {
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
    }
    newStep(action) {
        this.steps.push(action);
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
            ctx.data_response = newBody;
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
                var query = db(tableName);
                if (filter) {

                }

                response = await query.select().catch(console.error);
            }
            ctx.data_response = {
                success: response !== null && response !== undefined,
                data: response
            };
        });
        return this;
    }
    create() {

    }
}


module.exports = {
    DataRestBuilder
};