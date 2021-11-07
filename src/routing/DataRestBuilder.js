const FastApiRouter = require('fastapi-express').FastApiRouter;
const FastApiContext = require('fastapi-express').JSDOC.FastApiContext;
const Migration = require('../db/Migration');
const DBConnection = require('../db/DatabaseConnection');
const getSchemaDBConnection = require('../db/SchemaDBConnector').getDBConnector;
const fs = require('fs');
const path = require('path');
const knex = require('knex').knex;
const EntityManager = require('fastapi-express').KnexEntityPlugin.EntityManager;
const uuid = require('uuid').v4;
const { DataRouterBuilder } = require('./DataRouterBuilder');

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
            this.migration = new Migration(new DBConnection(db));
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





module.exports = {
    DataRestBuilder,
};