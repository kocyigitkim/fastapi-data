const { Knex } = require("knex");
const { DataRestBuilder, DataActionBuilder } = require("../routing/DataRestBuilder");
const uuid = require('uuid').v4;

class DatabasePoolResult {
    /**
     * 
     * @param {{id:string,result:any}[]} results 
     * @param {string[]} errors 
     */
    constructor(results, errors) {
        this.results = results;
        this.errors = errors;
    }
    find(id) {
        return this.results.find(x => x.id === id)[0];
    }
    success() {
        return this.errors.length === 0;
    }
    error() {
        return this.errors.length > 0;
    }
}

class DatabasePool {
    /** 
     * @param {Knex} db 
     * @param {DataRestBuilder} builder
     * @param {DataActionBuilder} action
     * */
    constructor(db, builder, action) {
        this.actions = [];
        this.registry = {};
        this.db = db;
        this.builder = builder;
        this.action = action;
        this.fields = [];
    }
    setFields(fields) {
        this.fields = fields;
    }
    insert(record) {
        var id = uuid();
        this.actions.push({
            id: id,
            action: async (pool) => {
                
            }
        });
        return id;
    }
    async execute() {
        var ctx = {};
        var results = [];
        var errors = [];
        var poolResult = new DatabasePoolResult(results, errors);
        for (let action of this.actions) {
            await action.action(ctx).then(p => {
                results.push({
                    id: action.id,
                    result: result
                });
            }).catch((err) => {
                console.error(err);
                errors.push(err.toString());
            });
        }
        return poolResult;
    }
}

module.exports = {
    DatabasePool,
    DatabasePoolResult
};