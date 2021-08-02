const knex = require('knex');
class DatabaseConnection {
    constructor(db) {
        if(db.name === "knex"){
            this.db = db;
            this.isKnex = true;
            registerKnex(this.db);
            this.config = db.context.client.config;
            return;
        }
        this.config = db;
        if (db.client !== 'mongodb') {
            this.db = knex(db);
            this.isKnex = true;
            registerKnex(this.db);
        }
        else {
            this.isKnex = false;
        }
    }
    async query(q, args) {
        return null;
    }
    async insert(q) {
        return false;
    }
    async update(q, where) {
        return false;
    }
    async delete(q, where) {
        return false;
    }
}

/**
 * 
 * @param {knex.default} knex 
 */
function registerKnex(knex) {
    const client = knex.context.client.config.client;
    if (client !== "mssql" && client !== "mysql") return;
    const dbName = knex.context.client.config.connection.database;

    knex.existsTable = async (tableName) => {
        var results = await knex("INFORMATION_SCHEMA.TABLES").where("TABLE_CATALOG", dbName).where("TABLE_NAME", tableName).catch(console.error);
        return results && results.length > 0;
    };
}

module.exports = DatabaseConnection;