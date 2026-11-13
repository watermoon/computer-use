'use strict';
// Never expose raw loader output, paths or inherited secrets to the UI/MCP.
function nativeHelperError(error, stderr = '') {
  const detail = String(stderr).slice(0, 8192);
  let code = 'CU_HELPER_START_FAILED';
  if (/libswift_stdio\.dylib|Library not loaded|Symbol not found|built for (?:macOS|Mac OS X)|requires macOS/i.test(detail)) code = 'CU_HELPER_OS_INCOMPATIBLE';
  else if (error?.code === 'ENOENT') code = 'CU_HELPER_UNAVAILABLE';
  else if (error?.code === 'EACCES' || error?.code === 'EPERM') code = 'CU_HELPER_NOT_EXECUTABLE';
  else if (error?.code === 'EBADARCH' || /Bad CPU type|incompatible architecture/i.test(detail)) code = 'CU_HELPER_ARCH_INCOMPATIBLE';
  else if (error?.killed || error?.code === 'ETIMEDOUT') code = 'CU_HELPER_TIMEOUT';
  return Object.assign(new Error(code), {code});
}
module.exports = {nativeHelperError};
