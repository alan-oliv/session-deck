#include <node_api.h>
#import <Cocoa/Cocoa.h>

// Private SkyLight API, the same call iTerm2 and Warp use for window background blur.
typedef int CGSConnectionID;
extern "C" CGSConnectionID CGSMainConnectionID(void);
extern "C" int CGSSetWindowBackgroundBlurRadius(CGSConnectionID cid, NSInteger wid, int radius);

// setBlur(handle: Buffer from BrowserWindow.getNativeWindowHandle(), radius: number) -> CGError, 0 = ok
static napi_value SetBlur(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  void *data;
  size_t len;
  int32_t radius;
  if (argc < 2 || napi_get_buffer_info(env, argv[0], &data, &len) != napi_ok || len < sizeof(void *) ||
      napi_get_value_int32(env, argv[1], &radius) != napi_ok) {
    napi_throw_type_error(env, nullptr, "setBlur(handle: Buffer, radius: number)");
    return nullptr;
  }
  NSView *view = *(NSView * __unsafe_unretained *)data;
  int err = CGSSetWindowBackgroundBlurRadius(CGSMainConnectionID(), view.window.windowNumber, radius);
  napi_value out;
  napi_create_int32(env, err, &out);
  return out;
}

NAPI_MODULE_INIT() {
  napi_value fn;
  napi_create_function(env, "setBlur", NAPI_AUTO_LENGTH, SetBlur, nullptr, &fn);
  napi_set_named_property(env, exports, "setBlur", fn);
  return exports;
}
