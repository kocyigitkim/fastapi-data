const { DataActionBuilder } = require("./DataActionBuilder");
const NodeCache = require("node-cache");
const dataCache = new NodeCache({ stdTTL: 60 * 30, checkperiod: 60 * 10, deleteOnExpire: true, useClones: true });
const uuid = require('uuid').v4;
const FastApiRouter = require('fastapi-express').FastApiRouter;


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
        actionBuilder.id = uuid();
        this.actions.push(actionBuilder);
        this.router.post(name, RouterActionTemplate.bind(this, actionBuilder));
        return actionBuilder;
    }
}

/**
 * 
 * @param {DataActionBuilder} actionBuilder 
 * @param {*} ctx 
 */
async function RouterActionTemplate(actionBuilder, ctx) {
    var isCached = actionBuilder.cacheEnabled;
    if (isCached && dataCache.has(actionBuilder.id)) {
        return dataCache.get(actionBuilder.id);
    }
    const steps = actionBuilder.steps;
    for (var step of steps) {
        var r = step(ctx);
        if (r instanceof Promise)
            r = await r.catch(console.error);
    }
    var withoutFields = (actionBuilder.withoutFields || []);
    if (ctx.data_response && Array.isArray(ctx.data_response.data)) {
        ctx.data_response.data = ctx.data_response.data.map(item => {
            withoutFields.forEach(field => {
                try { delete item[field]; } catch (err) { }
            });
            return item;
        });
    }
    else if (ctx.data_response) {
        withoutFields.forEach(field => {
            try { delete ctx.data_response.data[field]; } catch (err) { }
        });
    }
    if (isCached) {
        if (ctx.data_response && ctx.data_response.success) {
            dataCache.set(actionBuilder.id, ctx.data_response);
        }
    }
    return ctx.data_response;
}

module.exports = { DataRouterBuilder };