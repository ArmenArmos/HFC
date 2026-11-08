const path = require("node:path");
const sharedRoot = path.resolve(__dirname, "../../../lib");
module.exports = (request, options) => {
  if (
    (request === "zod" || request.startsWith("@babel/runtime/")) &&
    (options.basedir === sharedRoot ||
      options.basedir.startsWith(sharedRoot + path.sep))
  )
    return require.resolve(request);
  return options.defaultResolver(request, options);
};
