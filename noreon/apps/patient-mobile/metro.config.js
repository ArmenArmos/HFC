const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const config = getDefaultConfig(__dirname);
// The native package is isolated, but shared pure validation/contracts live here.
config.watchFolders = [path.resolve(__dirname, "../../lib")];
// Shared validators sit outside this isolated workspace. Bind their Zod import
// to the native declaration without retargeting other packages' Zod versions.
const sharedLib = path.resolve(__dirname, "../../lib") + path.sep;
const previousResolver = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "zod" && context.originModulePath.startsWith(sharedLib)) {
    return context.resolveRequest(context, require.resolve("zod"), platform);
  }
  return previousResolver
    ? previousResolver(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
