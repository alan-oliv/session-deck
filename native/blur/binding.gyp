{
  "targets": [{
    "target_name": "blur",
    "sources": ["blur.mm"],
    "xcode_settings": {
      "OTHER_LDFLAGS": ["-framework Cocoa", "-F/System/Library/PrivateFrameworks", "-framework SkyLight"],
      "CLANG_ENABLE_OBJC_ARC": "YES",
      "MACOSX_DEPLOYMENT_TARGET": "14.2"
    }
  }]
}
