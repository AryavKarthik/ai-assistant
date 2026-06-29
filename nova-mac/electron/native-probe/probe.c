#include <node_api.h>

static napi_value Probe(napi_env env, napi_callback_info info) {
  napi_value result;
  napi_create_string_utf8(env, "native-ok", NAPI_AUTO_LENGTH, &result);
  return result;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, NULL, 0, Probe, NULL, &fn);
  napi_set_named_property(env, exports, "probe", fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
