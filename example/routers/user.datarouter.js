const { DataRestBuilder } = require("../../src/DataRestBuilder");

/**
 * @param {DataRestBuilder} builder
*/
async function init(builder){
    const router = builder.router("SystemUser");
    router.action("list").list().mapResult({
        test: ()=>1,
        Username: 'Username'   
    });
 //   router.action("create").create();
   /* router.action("edit").edit();
    router.action("delete").delete();
    router.action("setState").setState();*/
}

module.exports = {
    init: init
};