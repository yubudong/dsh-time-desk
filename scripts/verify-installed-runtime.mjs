// Run using the installed Electron runtime so its ASAR-backed packages resolve.
import assert from "node:assert/strict";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { apply, inject } from "../dist/index.js";
const anchor = process.argv[2];
if (!anchor) throw new Error("Pass the verified DSH installation directory");
const require = createRequire(path.join(anchor, "package.json"));
const load = async name => import(pathToFileURL(require.resolve(name)).href);
const { JsonStorageBackend } = await load("@deepseek-ai/dsh-storage-json");
const { UNIT_NAME_RE } = await load("@deepseek-ai/dsh-storage");
const { HostConnectionService } = await load("@deepseek-ai/dsh-client-connection");
const { Context } = await load("@deepseek-ai/cordis");
const workspace = await realpath(process.cwd());
const temp = await mkdtemp(path.join(workspace, ".life-desk-runtime-test-"));
const backend = new JsonStorageBackend(temp);
const root = new Context();
const connection = new HostConnectionService(root, [], {
  isAuthenticated: () => false,
  authenticateApi: () => undefined,
});
const disposers = [];
let tool;
try {
  await assert.rejects(backend.kv.open({name:"life-desk-v1",version:1,tables:["backups"],hasGlobal:true}), /invalid unit name/);
  assert.ok(inject.includes("storage.backend.json"));
  const ctx = {
    storage:{backend:{get(name){assert.equal(name,"json");return backend;}}},
    connection,
    tools:{register(def){tool=def;return()=>{};}},
    effect(callback){const result=callback();disposers.push(async()=>{const cleanup=await result;if(typeof cleanup==="function")await cleanup();});},
    provide(name, value){assert.equal(name,"lifeDesk");assert.equal(typeof value.operate,"function");},
  };
  await apply(ctx);
  const handler = connection.createSharedFetchHandler("/api");
  const request = action => handler.fetch(new Request("http://127.0.0.1/api/life-desk",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(action)}),connection.browserPeer);
  const response = await request({action:"read"});
  assert.equal(response.status,200);
  const initial=await response.json();assert.equal(initial.ok,true);assert.equal(initial.value.revision,0);
  await tool.execute({action:"save",revision:0,collection:"tasks",item:{title:"Runtime test"}});
  const read=await (await request({action:"read"})).json();assert.equal(read.value.tasks[0].title,"Runtime test");
  const bad=await request({action:"save",revision:0,collection:"tasks",item:{title:"Stale"}});assert.equal(bad.status,400);
  const started=await (await request({action:"timer",command:"start",revision:1,item:{minutes:10}})).json();assert.equal(started.value.timer.duration,600);assert.equal(started.value.settings.focusMinutes,25);
  const preference=await (await request({action:"settings",revision:2,item:{focusMinutes:45,timerFace:"ring"}})).json();assert.deepEqual(preference.value.timer,started.value.timer);assert.equal(preference.value.settings.focusMinutes,45);
  const ended=await request({action:"timer",command:"discard",revision:3,timerId:started.value.timer.id});assert.equal(ended.status,200);
  for(const callback of disposers.splice(0).reverse())if(typeof callback==="function")await callback();
  const reopened=await backend.kv.open({name:"life_desk_v1",version:1,tables:["backups"],hasGlobal:true,layout:"single"});
  assert.ok(UNIT_NAME_RE.test("life_desk_v1"));assert.equal((await reopened.loadAll()).global.tasks[0].title,"Runtime test");await reopened.close();
  console.log("PASS: real installed storage + real Connection route read/write + persistent reopen");
} finally {
  for(const callback of disposers.reverse())if(typeof callback==="function")await callback();
  await root.fiber.dispose();await backend.close();
  const resolved=await realpath(temp);
  assert.equal(path.dirname(resolved),workspace);assert.ok(path.basename(resolved).startsWith(".life-desk-runtime-test-"));
  await rm(resolved,{recursive:true,force:true});
}
