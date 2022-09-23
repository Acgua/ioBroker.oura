var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var methods_exports = {};
__export(methods_exports, {
  err2Str: () => err2Str,
  getIsoDate: () => getIsoDate,
  wait: () => wait
});
module.exports = __toCommonJS(methods_exports);
/**
 * Methods and Tools
 * @desc    Methods and Tools
 * @author  Acgua <https://github.com/Acgua/ioBroker.oura>
 * @license Apache License 2.0
 *
 * ----------------------------------------------------------------------------------------
 * How to implement this file in main.ts (see also https://stackoverflow.com/a/58459668)
 * ----------------------------------------------------------------------------------------
 *  1. Add "this: Oura" as first function parameter if you need access to "this"
 *       -> no need to provide this parameter when calling the method, though!
 *  1. Add line like "import { err2Str, isEmpty } from './lib/methods';"
 *  2. Add keyword "export" before "class Oura extends utils.Adapter"
 *  3. class Oura: for each method, add line like: "public isEmpty = isEmpty.bind(this);"
 *           Note: use "private isEmpty..." and not "public", if you do not need to access method from this file
 */
function err2Str(error) {
  if (error instanceof Error) {
    if (error.stack)
      return error.stack;
    if (error.message)
      return error.message;
    return JSON.stringify(error);
  } else {
    if (typeof error === "string")
      return error;
    return JSON.stringify(error);
  }
}
async function wait(ms) {
  try {
    await new Promise((w) => setTimeout(w, ms));
  } catch (e) {
    this.log.error(this.err2Str(e));
    return;
  }
}
function getIsoDate(date) {
  try {
    let d;
    if (date instanceof Date && date.getMonth()) {
      d = date;
    } else if (typeof date === "number" && date.toString().length > 12) {
      d = new Date(date);
    } else {
      throw "Invalid date object or timestamp provided";
    }
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${month}-${day}`;
  } catch (e) {
    this.log.error("Invalid date object or timestamp provided");
    return false;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  err2Str,
  getIsoDate,
  wait
});
//# sourceMappingURL=methods.js.map
