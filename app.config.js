const appJson = require("./app.json");

module.exports = ({ config }) => {
  const base = appJson.expo ?? {};
  const basePlugins = Array.isArray(base.plugins) ? base.plugins : [];
  const plugins = basePlugins.includes("@react-native-community/datetimepicker")
    ? basePlugins
    : [...basePlugins, "@react-native-community/datetimepicker"];
  return {
    ...config,
    ...base,
    plugins,
    extra: base.extra ?? {},
  };
};
