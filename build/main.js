(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */

var base64 = require('base64-js')
var ieee754 = require('ieee754')

exports.Buffer = Buffer
exports.SlowBuffer = Buffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192

/**
 * If `Buffer._useTypedArrays`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (compatible down to IE6)
 */
Buffer._useTypedArrays = (function () {
  // Detect if browser supports Typed Arrays. Supported browsers are IE 10+, Firefox 4+,
  // Chrome 7+, Safari 5.1+, Opera 11.6+, iOS 4.2+. If the browser does not support adding
  // properties to `Uint8Array` instances, then that's the same as no `Uint8Array` support
  // because we need to be able to add all the node Buffer API methods. This is an issue
  // in Firefox 4-29. Now fixed: https://bugzilla.mozilla.org/show_bug.cgi?id=695438
  try {
    var buf = new ArrayBuffer(0)
    var arr = new Uint8Array(buf)
    arr.foo = function () { return 42 }
    return 42 === arr.foo() &&
        typeof arr.subarray === 'function' // Chrome 9-10 lack `subarray`
  } catch (e) {
    return false
  }
})()

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (subject, encoding, noZero) {
  if (!(this instanceof Buffer))
    return new Buffer(subject, encoding, noZero)

  var type = typeof subject

  // Workaround: node's base64 implementation allows for non-padded strings
  // while base64-js does not.
  if (encoding === 'base64' && type === 'string') {
    subject = stringtrim(subject)
    while (subject.length % 4 !== 0) {
      subject = subject + '='
    }
  }

  // Find the length
  var length
  if (type === 'number')
    length = coerce(subject)
  else if (type === 'string')
    length = Buffer.byteLength(subject, encoding)
  else if (type === 'object')
    length = coerce(subject.length) // assume that object is array-like
  else
    throw new Error('First argument needs to be a number, array or string.')

  var buf
  if (Buffer._useTypedArrays) {
    // Preferred: Return an augmented `Uint8Array` instance for best performance
    buf = Buffer._augment(new Uint8Array(length))
  } else {
    // Fallback: Return THIS instance of Buffer (created by `new`)
    buf = this
    buf.length = length
    buf._isBuffer = true
  }

  var i
  if (Buffer._useTypedArrays && typeof subject.byteLength === 'number') {
    // Speed optimization -- use set if we're copying from a typed array
    buf._set(subject)
  } else if (isArrayish(subject)) {
    // Treat array-ish objects as a byte array
    for (i = 0; i < length; i++) {
      if (Buffer.isBuffer(subject))
        buf[i] = subject.readUInt8(i)
      else
        buf[i] = subject[i]
    }
  } else if (type === 'string') {
    buf.write(subject, 0, encoding)
  } else if (type === 'number' && !Buffer._useTypedArrays && !noZero) {
    for (i = 0; i < length; i++) {
      buf[i] = 0
    }
  }

  return buf
}

// STATIC METHODS
// ==============

Buffer.isEncoding = function (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.isBuffer = function (b) {
  return !!(b !== null && b !== undefined && b._isBuffer)
}

Buffer.byteLength = function (str, encoding) {
  var ret
  str = str + ''
  switch (encoding || 'utf8') {
    case 'hex':
      ret = str.length / 2
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8ToBytes(str).length
      break
    case 'ascii':
    case 'binary':
    case 'raw':
      ret = str.length
      break
    case 'base64':
      ret = base64ToBytes(str).length
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = str.length * 2
      break
    default:
      throw new Error('Unknown encoding')
  }
  return ret
}

Buffer.concat = function (list, totalLength) {
  assert(isArray(list), 'Usage: Buffer.concat(list, [totalLength])\n' +
      'list should be an Array.')

  if (list.length === 0) {
    return new Buffer(0)
  } else if (list.length === 1) {
    return list[0]
  }

  var i
  if (typeof totalLength !== 'number') {
    totalLength = 0
    for (i = 0; i < list.length; i++) {
      totalLength += list[i].length
    }
  }

  var buf = new Buffer(totalLength)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

// BUFFER INSTANCE METHODS
// =======================

function _hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  assert(strLen % 2 === 0, 'Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var byte = parseInt(string.substr(i * 2, 2), 16)
    assert(!isNaN(byte), 'Invalid hex string')
    buf[offset + i] = byte
  }
  Buffer._charsWritten = i * 2
  return i
}

function _utf8Write (buf, string, offset, length) {
  var charsWritten = Buffer._charsWritten =
    blitBuffer(utf8ToBytes(string), buf, offset, length)
  return charsWritten
}

function _asciiWrite (buf, string, offset, length) {
  var charsWritten = Buffer._charsWritten =
    blitBuffer(asciiToBytes(string), buf, offset, length)
  return charsWritten
}

function _binaryWrite (buf, string, offset, length) {
  return _asciiWrite(buf, string, offset, length)
}

function _base64Write (buf, string, offset, length) {
  var charsWritten = Buffer._charsWritten =
    blitBuffer(base64ToBytes(string), buf, offset, length)
  return charsWritten
}

function _utf16leWrite (buf, string, offset, length) {
  var charsWritten = Buffer._charsWritten =
    blitBuffer(utf16leToBytes(string), buf, offset, length)
  return charsWritten
}

Buffer.prototype.write = function (string, offset, length, encoding) {
  // Support both (string, offset, length, encoding)
  // and the legacy (string, encoding, offset, length)
  if (isFinite(offset)) {
    if (!isFinite(length)) {
      encoding = length
      length = undefined
    }
  } else {  // legacy
    var swap = encoding
    encoding = offset
    offset = length
    length = swap
  }

  offset = Number(offset) || 0
  var remaining = this.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }
  encoding = String(encoding || 'utf8').toLowerCase()

  var ret
  switch (encoding) {
    case 'hex':
      ret = _hexWrite(this, string, offset, length)
      break
    case 'utf8':
    case 'utf-8':
      ret = _utf8Write(this, string, offset, length)
      break
    case 'ascii':
      ret = _asciiWrite(this, string, offset, length)
      break
    case 'binary':
      ret = _binaryWrite(this, string, offset, length)
      break
    case 'base64':
      ret = _base64Write(this, string, offset, length)
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = _utf16leWrite(this, string, offset, length)
      break
    default:
      throw new Error('Unknown encoding')
  }
  return ret
}

Buffer.prototype.toString = function (encoding, start, end) {
  var self = this

  encoding = String(encoding || 'utf8').toLowerCase()
  start = Number(start) || 0
  end = (end !== undefined)
    ? Number(end)
    : end = self.length

  // Fastpath empty strings
  if (end === start)
    return ''

  var ret
  switch (encoding) {
    case 'hex':
      ret = _hexSlice(self, start, end)
      break
    case 'utf8':
    case 'utf-8':
      ret = _utf8Slice(self, start, end)
      break
    case 'ascii':
      ret = _asciiSlice(self, start, end)
      break
    case 'binary':
      ret = _binarySlice(self, start, end)
      break
    case 'base64':
      ret = _base64Slice(self, start, end)
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = _utf16leSlice(self, start, end)
      break
    default:
      throw new Error('Unknown encoding')
  }
  return ret
}

Buffer.prototype.toJSON = function () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function (target, target_start, start, end) {
  var source = this

  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (!target_start) target_start = 0

  // Copy 0 bytes; we're done
  if (end === start) return
  if (target.length === 0 || source.length === 0) return

  // Fatal error conditions
  assert(end >= start, 'sourceEnd < sourceStart')
  assert(target_start >= 0 && target_start < target.length,
      'targetStart out of bounds')
  assert(start >= 0 && start < source.length, 'sourceStart out of bounds')
  assert(end >= 0 && end <= source.length, 'sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length)
    end = this.length
  if (target.length - target_start < end - start)
    end = target.length - target_start + start

  var len = end - start

  if (len < 100 || !Buffer._useTypedArrays) {
    for (var i = 0; i < len; i++)
      target[i + target_start] = this[i + start]
  } else {
    target._set(this.subarray(start, start + len), target_start)
  }
}

function _base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function _utf8Slice (buf, start, end) {
  var res = ''
  var tmp = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    if (buf[i] <= 0x7F) {
      res += decodeUtf8Char(tmp) + String.fromCharCode(buf[i])
      tmp = ''
    } else {
      tmp += '%' + buf[i].toString(16)
    }
  }

  return res + decodeUtf8Char(tmp)
}

function _asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++)
    ret += String.fromCharCode(buf[i])
  return ret
}

function _binarySlice (buf, start, end) {
  return _asciiSlice(buf, start, end)
}

function _hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function _utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i+1] * 256)
  }
  return res
}

Buffer.prototype.slice = function (start, end) {
  var len = this.length
  start = clamp(start, len, 0)
  end = clamp(end, len, len)

  if (Buffer._useTypedArrays) {
    return Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    var newBuf = new Buffer(sliceLen, undefined, true)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
    return newBuf
  }
}

// `get` will be removed in Node 0.13+
Buffer.prototype.get = function (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` will be removed in Node 0.13+
Buffer.prototype.set = function (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

Buffer.prototype.readUInt8 = function (offset, noAssert) {
  if (!noAssert) {
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset < this.length, 'Trying to read beyond buffer length')
  }

  if (offset >= this.length)
    return

  return this[offset]
}

function _readUInt16 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val
  if (littleEndian) {
    val = buf[offset]
    if (offset + 1 < len)
      val |= buf[offset + 1] << 8
  } else {
    val = buf[offset] << 8
    if (offset + 1 < len)
      val |= buf[offset + 1]
  }
  return val
}

Buffer.prototype.readUInt16LE = function (offset, noAssert) {
  return _readUInt16(this, offset, true, noAssert)
}

Buffer.prototype.readUInt16BE = function (offset, noAssert) {
  return _readUInt16(this, offset, false, noAssert)
}

function _readUInt32 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val
  if (littleEndian) {
    if (offset + 2 < len)
      val = buf[offset + 2] << 16
    if (offset + 1 < len)
      val |= buf[offset + 1] << 8
    val |= buf[offset]
    if (offset + 3 < len)
      val = val + (buf[offset + 3] << 24 >>> 0)
  } else {
    if (offset + 1 < len)
      val = buf[offset + 1] << 16
    if (offset + 2 < len)
      val |= buf[offset + 2] << 8
    if (offset + 3 < len)
      val |= buf[offset + 3]
    val = val + (buf[offset] << 24 >>> 0)
  }
  return val
}

Buffer.prototype.readUInt32LE = function (offset, noAssert) {
  return _readUInt32(this, offset, true, noAssert)
}

Buffer.prototype.readUInt32BE = function (offset, noAssert) {
  return _readUInt32(this, offset, false, noAssert)
}

Buffer.prototype.readInt8 = function (offset, noAssert) {
  if (!noAssert) {
    assert(offset !== undefined && offset !== null,
        'missing offset')
    assert(offset < this.length, 'Trying to read beyond buffer length')
  }

  if (offset >= this.length)
    return

  var neg = this[offset] & 0x80
  if (neg)
    return (0xff - this[offset] + 1) * -1
  else
    return this[offset]
}

function _readInt16 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val = _readUInt16(buf, offset, littleEndian, true)
  var neg = val & 0x8000
  if (neg)
    return (0xffff - val + 1) * -1
  else
    return val
}

Buffer.prototype.readInt16LE = function (offset, noAssert) {
  return _readInt16(this, offset, true, noAssert)
}

Buffer.prototype.readInt16BE = function (offset, noAssert) {
  return _readInt16(this, offset, false, noAssert)
}

function _readInt32 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val = _readUInt32(buf, offset, littleEndian, true)
  var neg = val & 0x80000000
  if (neg)
    return (0xffffffff - val + 1) * -1
  else
    return val
}

Buffer.prototype.readInt32LE = function (offset, noAssert) {
  return _readInt32(this, offset, true, noAssert)
}

Buffer.prototype.readInt32BE = function (offset, noAssert) {
  return _readInt32(this, offset, false, noAssert)
}

function _readFloat (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset + 3 < buf.length, 'Trying to read beyond buffer length')
  }

  return ieee754.read(buf, offset, littleEndian, 23, 4)
}

Buffer.prototype.readFloatLE = function (offset, noAssert) {
  return _readFloat(this, offset, true, noAssert)
}

Buffer.prototype.readFloatBE = function (offset, noAssert) {
  return _readFloat(this, offset, false, noAssert)
}

function _readDouble (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset + 7 < buf.length, 'Trying to read beyond buffer length')
  }

  return ieee754.read(buf, offset, littleEndian, 52, 8)
}

Buffer.prototype.readDoubleLE = function (offset, noAssert) {
  return _readDouble(this, offset, true, noAssert)
}

Buffer.prototype.readDoubleBE = function (offset, noAssert) {
  return _readDouble(this, offset, false, noAssert)
}

Buffer.prototype.writeUInt8 = function (value, offset, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset < this.length, 'trying to write beyond buffer length')
    verifuint(value, 0xff)
  }

  if (offset >= this.length) return

  this[offset] = value
}

function _writeUInt16 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'trying to write beyond buffer length')
    verifuint(value, 0xffff)
  }

  var len = buf.length
  if (offset >= len)
    return

  for (var i = 0, j = Math.min(len - offset, 2); i < j; i++) {
    buf[offset + i] =
        (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
            (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function (value, offset, noAssert) {
  _writeUInt16(this, value, offset, true, noAssert)
}

Buffer.prototype.writeUInt16BE = function (value, offset, noAssert) {
  _writeUInt16(this, value, offset, false, noAssert)
}

function _writeUInt32 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'trying to write beyond buffer length')
    verifuint(value, 0xffffffff)
  }

  var len = buf.length
  if (offset >= len)
    return

  for (var i = 0, j = Math.min(len - offset, 4); i < j; i++) {
    buf[offset + i] =
        (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function (value, offset, noAssert) {
  _writeUInt32(this, value, offset, true, noAssert)
}

Buffer.prototype.writeUInt32BE = function (value, offset, noAssert) {
  _writeUInt32(this, value, offset, false, noAssert)
}

Buffer.prototype.writeInt8 = function (value, offset, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset < this.length, 'Trying to write beyond buffer length')
    verifsint(value, 0x7f, -0x80)
  }

  if (offset >= this.length)
    return

  if (value >= 0)
    this.writeUInt8(value, offset, noAssert)
  else
    this.writeUInt8(0xff + value + 1, offset, noAssert)
}

function _writeInt16 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'Trying to write beyond buffer length')
    verifsint(value, 0x7fff, -0x8000)
  }

  var len = buf.length
  if (offset >= len)
    return

  if (value >= 0)
    _writeUInt16(buf, value, offset, littleEndian, noAssert)
  else
    _writeUInt16(buf, 0xffff + value + 1, offset, littleEndian, noAssert)
}

Buffer.prototype.writeInt16LE = function (value, offset, noAssert) {
  _writeInt16(this, value, offset, true, noAssert)
}

Buffer.prototype.writeInt16BE = function (value, offset, noAssert) {
  _writeInt16(this, value, offset, false, noAssert)
}

function _writeInt32 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to write beyond buffer length')
    verifsint(value, 0x7fffffff, -0x80000000)
  }

  var len = buf.length
  if (offset >= len)
    return

  if (value >= 0)
    _writeUInt32(buf, value, offset, littleEndian, noAssert)
  else
    _writeUInt32(buf, 0xffffffff + value + 1, offset, littleEndian, noAssert)
}

Buffer.prototype.writeInt32LE = function (value, offset, noAssert) {
  _writeInt32(this, value, offset, true, noAssert)
}

Buffer.prototype.writeInt32BE = function (value, offset, noAssert) {
  _writeInt32(this, value, offset, false, noAssert)
}

function _writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to write beyond buffer length')
    verifIEEE754(value, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }

  var len = buf.length
  if (offset >= len)
    return

  ieee754.write(buf, value, offset, littleEndian, 23, 4)
}

Buffer.prototype.writeFloatLE = function (value, offset, noAssert) {
  _writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function (value, offset, noAssert) {
  _writeFloat(this, value, offset, false, noAssert)
}

function _writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 7 < buf.length,
        'Trying to write beyond buffer length')
    verifIEEE754(value, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }

  var len = buf.length
  if (offset >= len)
    return

  ieee754.write(buf, value, offset, littleEndian, 52, 8)
}

Buffer.prototype.writeDoubleLE = function (value, offset, noAssert) {
  _writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function (value, offset, noAssert) {
  _writeDouble(this, value, offset, false, noAssert)
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (typeof value === 'string') {
    value = value.charCodeAt(0)
  }

  assert(typeof value === 'number' && !isNaN(value), 'value is not a number')
  assert(end >= start, 'end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  assert(start >= 0 && start < this.length, 'start out of bounds')
  assert(end >= 0 && end <= this.length, 'end out of bounds')

  for (var i = start; i < end; i++) {
    this[i] = value
  }
}

Buffer.prototype.inspect = function () {
  var out = []
  var len = this.length
  for (var i = 0; i < len; i++) {
    out[i] = toHex(this[i])
    if (i === exports.INSPECT_MAX_BYTES) {
      out[i + 1] = '...'
      break
    }
  }
  return '<Buffer ' + out.join(' ') + '>'
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer._useTypedArrays) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1)
        buf[i] = this[i]
      return buf.buffer
    }
  } else {
    throw new Error('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function (arr) {
  arr._isBuffer = true

  // save reference to original Uint8Array get/set methods before overwriting
  arr._get = arr.get
  arr._set = arr.set

  // deprecated, will be removed in node 0.13+
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

// slice(start, end)
function clamp (index, len, defaultValue) {
  if (typeof index !== 'number') return defaultValue
  index = ~~index;  // Coerce to integer.
  if (index >= len) return len
  if (index >= 0) return index
  index += len
  if (index >= 0) return index
  return 0
}

function coerce (length) {
  // Coerce length to a number (possibly NaN), round up
  // in case it's fractional (e.g. 123.456) then do a
  // double negate to coerce a NaN to 0. Easy, right?
  length = ~~Math.ceil(+length)
  return length < 0 ? 0 : length
}

function isArray (subject) {
  return (Array.isArray || function (subject) {
    return Object.prototype.toString.call(subject) === '[object Array]'
  })(subject)
}

function isArrayish (subject) {
  return isArray(subject) || Buffer.isBuffer(subject) ||
      subject && typeof subject === 'object' &&
      typeof subject.length === 'number'
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    var b = str.charCodeAt(i)
    if (b <= 0x7F)
      byteArray.push(str.charCodeAt(i))
    else {
      var start = i
      if (b >= 0xD800 && b <= 0xDFFF) i++
      var h = encodeURIComponent(str.slice(start, i+1)).substr(1).split('%')
      for (var j = 0; j < h.length; j++)
        byteArray.push(parseInt(h[j], 16))
    }
  }
  return byteArray
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(str)
}

function blitBuffer (src, dst, offset, length) {
  var pos
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length))
      break
    dst[i + offset] = src[i]
  }
  return i
}

function decodeUtf8Char (str) {
  try {
    return decodeURIComponent(str)
  } catch (err) {
    return String.fromCharCode(0xFFFD) // UTF 8 invalid char
  }
}

/*
 * We have to make sure that the value is a valid integer. This means that it
 * is non-negative. It has no fractional component and that it does not
 * exceed the maximum allowed value.
 */
function verifuint (value, max) {
  assert(typeof value === 'number', 'cannot write a non-number as a number')
  assert(value >= 0, 'specified a negative value for writing an unsigned value')
  assert(value <= max, 'value is larger than maximum value for type')
  assert(Math.floor(value) === value, 'value has a fractional component')
}

function verifsint (value, max, min) {
  assert(typeof value === 'number', 'cannot write a non-number as a number')
  assert(value <= max, 'value larger than maximum allowed value')
  assert(value >= min, 'value smaller than minimum allowed value')
  assert(Math.floor(value) === value, 'value has a fractional component')
}

function verifIEEE754 (value, max, min) {
  assert(typeof value === 'number', 'cannot write a non-number as a number')
  assert(value <= max, 'value larger than maximum allowed value')
  assert(value >= min, 'value smaller than minimum allowed value')
}

function assert (test, message) {
  if (!test) throw new Error(message || 'Failed assertion')
}

}).call(this,require("oMfpAn"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../../node_modules/gulp-browserify/node_modules/browserify/node_modules/buffer/index.js","/../../node_modules/gulp-browserify/node_modules/browserify/node_modules/buffer")
},{"base64-js":2,"buffer":1,"ieee754":3,"oMfpAn":4}],2:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)
	var PLUS_URL_SAFE = '-'.charCodeAt(0)
	var SLASH_URL_SAFE = '_'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS ||
		    code === PLUS_URL_SAFE)
			return 62 // '+'
		if (code === SLASH ||
		    code === SLASH_URL_SAFE)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	exports.toByteArray = b64ToByteArray
	exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

}).call(this,require("oMfpAn"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../../node_modules/gulp-browserify/node_modules/browserify/node_modules/buffer/node_modules/base64-js/lib/b64.js","/../../node_modules/gulp-browserify/node_modules/browserify/node_modules/buffer/node_modules/base64-js/lib")
},{"buffer":1,"oMfpAn":4}],3:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

}).call(this,require("oMfpAn"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../../node_modules/gulp-browserify/node_modules/browserify/node_modules/buffer/node_modules/ieee754/index.js","/../../node_modules/gulp-browserify/node_modules/browserify/node_modules/buffer/node_modules/ieee754")
},{"buffer":1,"oMfpAn":4}],4:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
// shim for using process in browser

var process = module.exports = {};

process.nextTick = (function () {
    var canSetImmediate = typeof window !== 'undefined'
    && window.setImmediate;
    var canPost = typeof window !== 'undefined'
    && window.postMessage && window.addEventListener
    ;

    if (canSetImmediate) {
        return function (f) { return window.setImmediate(f) };
    }

    if (canPost) {
        var queue = [];
        window.addEventListener('message', function (ev) {
            var source = ev.source;
            if ((source === window || source === null) && ev.data === 'process-tick') {
                ev.stopPropagation();
                if (queue.length > 0) {
                    var fn = queue.shift();
                    fn();
                }
            }
        }, true);

        return function nextTick(fn) {
            queue.push(fn);
            window.postMessage('process-tick', '*');
        };
    }

    return function nextTick(fn) {
        setTimeout(fn, 0);
    };
})();

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
}

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};

}).call(this,require("oMfpAn"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../../node_modules/gulp-browserify/node_modules/browserify/node_modules/process/browser.js","/../../node_modules/gulp-browserify/node_modules/browserify/node_modules/process")
},{"buffer":1,"oMfpAn":4}],5:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
/*!
 * Object.observe polyfill - v0.2.4
 * by Massimo Artizzu (MaxArt2501)
 * 
 * https://github.com/MaxArt2501/object-observe
 * 
 * Licensed under the MIT License
 * See LICENSE for details
 */

// Some type definitions
/**
 * This represents the data relative to an observed object
 * @typedef  {Object}                     ObjectData
 * @property {Map<Handler, HandlerData>}  handlers
 * @property {String[]}                   properties
 * @property {*[]}                        values
 * @property {Descriptor[]}               descriptors
 * @property {Notifier}                   notifier
 * @property {Boolean}                    frozen
 * @property {Boolean}                    extensible
 * @property {Object}                     proto
 */
/**
 * Function definition of a handler
 * @callback Handler
 * @param {ChangeRecord[]}                changes
*/
/**
 * This represents the data relative to an observed object and one of its
 * handlers
 * @typedef  {Object}                     HandlerData
 * @property {Map<Object, ObservedData>}  observed
 * @property {ChangeRecord[]}             changeRecords
 */
/**
 * @typedef  {Object}                     ObservedData
 * @property {String[]}                   acceptList
 * @property {ObjectData}                 data
*/
/**
 * Type definition for a change. Any other property can be added using
 * the notify() or performChange() methods of the notifier.
 * @typedef  {Object}                     ChangeRecord
 * @property {String}                     type
 * @property {Object}                     object
 * @property {String}                     [name]
 * @property {*}                          [oldValue]
 * @property {Number}                     [index]
 */
/**
 * Type definition for a notifier (what Object.getNotifier returns)
 * @typedef  {Object}                     Notifier
 * @property {Function}                   notify
 * @property {Function}                   performChange
 */
/**
 * Function called with Notifier.performChange. It may optionally return a
 * ChangeRecord that gets automatically notified, but `type` and `object`
 * properties are overridden.
 * @callback Performer
 * @returns {ChangeRecord|undefined}
 */

Object.observe || (function(O, A, root) {
    "use strict";

        /**
         * Relates observed objects and their data
         * @type {Map<Object, ObjectData}
         */
    var observed,
        /**
         * List of handlers and their data
         * @type {Map<Handler, Map<Object, HandlerData>>}
         */
        handlers,

        defaultAcceptList = [ "add", "update", "delete", "reconfigure", "setPrototype", "preventExtensions" ];

    // Functions for internal usage

        /**
         * Checks if the argument is an Array object. Polyfills Array.isArray.
         * @function isArray
         * @param {?*} object
         * @returns {Boolean}
         */
    var isArray = A.isArray || (function(toString) {
            return function (object) { return toString.call(object) === "[object Array]"; };
        })(O.prototype.toString),

        /**
         * Returns the index of an item in a collection, or -1 if not found.
         * Uses the generic Array.indexOf or Array.prototype.indexOf if available.
         * @function inArray
         * @param {Array} array
         * @param {*} pivot           Item to look for
         * @param {Number} [start=0]  Index to start from
         * @returns {Number}
         */
        inArray = A.prototype.indexOf ? A.indexOf || function(array, pivot, start) {
            return A.prototype.indexOf.call(array, pivot, start);
        } : function(array, pivot, start) {
            for (var i = start || 0; i < array.length; i++)
                if (array[i] === pivot)
                    return i;
            return -1;
        },

        /**
         * Returns an instance of Map, or a Map-like object is Map is not
         * supported or doesn't support forEach()
         * @function createMap
         * @returns {Map}
         */
        createMap = typeof root.Map === "undefined" || !Map.prototype.forEach ? function() {
            // Lightweight shim of Map. Lacks clear(), entries(), keys() and
            // values() (the last 3 not supported by IE11, so can't use them),
            // it doesn't handle the constructor's argument (like IE11) and of
            // course it doesn't support for...of.
            // Chrome 31-35 and Firefox 13-24 have a basic support of Map, but
            // they lack forEach(), so their native implementation is bad for
            // this polyfill. (Chrome 36+ supports Object.observe.)
            var keys = [], values = [];

            return {
                size: 0,
                has: function(key) { return inArray(keys, key) > -1; },
                get: function(key) { return values[inArray(keys, key)]; },
                set: function(key, value) {
                    var i = inArray(keys, key);
                    if (i === -1) {
                        keys.push(key);
                        values.push(value);
                        this.size++;
                    } else values[i] = value;
                },
                "delete": function(key) {
                    var i = inArray(keys, key);
                    if (i > -1) {
                        keys.splice(i, 1);
                        values.splice(i, 1);
                        this.size--;
                    }
                },
                forEach: function(callback/*, thisObj*/) {
                    for (var i = 0; i < keys.length; i++)
                        callback.call(arguments[1], values[i], keys[i], this);
                }
            };
        } : function() { return new Map(); },

        /**
         * Simple shim for Object.getOwnPropertyNames when is not available
         * Misses checks on object, don't use as a replacement of Object.keys/getOwnPropertyNames
         * @function getProps
         * @param {Object} object
         * @returns {String[]}
         */
        getProps = O.getOwnPropertyNames ? (function() {
            var func = O.getOwnPropertyNames;
            try {
                arguments.callee;
            } catch (e) {
                // Strict mode is supported

                // In strict mode, we can't access to "arguments", "caller" and
                // "callee" properties of functions. Object.getOwnPropertyNames
                // returns [ "prototype", "length", "name" ] in Firefox; it returns
                // "caller" and "arguments" too in Chrome and in Internet
                // Explorer, so those values must be filtered.
                var avoid = (func(inArray).join(" ") + " ").replace(/prototype |length |name /g, "").slice(0, -1).split(" ");
                if (avoid.length) func = function(object) {
                    var props = O.getOwnPropertyNames(object);
                    if (typeof object === "function")
                        for (var i = 0, j; i < avoid.length;)
                            if ((j = inArray(props, avoid[i++])) > -1)
                                props.splice(j, 1);

                    return props;
                };
            }
            return func;
        })() : function(object) {
            // Poor-mouth version with for...in (IE8-)
            var props = [], prop, hop;
            if ("hasOwnProperty" in object) {
                for (prop in object)
                    if (object.hasOwnProperty(prop))
                        props.push(prop);
            } else {
                hop = O.hasOwnProperty;
                for (prop in object)
                    if (hop.call(object, prop))
                        props.push(prop);
            }

            // Inserting a common non-enumerable property of arrays
            if (isArray(object))
                props.push("length");

            return props;
        },

        /**
         * Return the prototype of the object... if defined.
         * @function getPrototype
         * @param {Object} object
         * @returns {Object}
         */
        getPrototype = O.getPrototypeOf,

        /**
         * Return the descriptor of the object... if defined.
         * IE8 supports a (useless) Object.getOwnPropertyDescriptor for DOM
         * nodes only, so defineProperties is checked instead.
         * @function getDescriptor
         * @param {Object} object
         * @param {String} property
         * @returns {Descriptor}
         */
        getDescriptor = O.defineProperties && O.getOwnPropertyDescriptor,

        /**
         * Sets up the next check and delivering iteration, using
         * requestAnimationFrame or a (close) polyfill.
         * @function nextFrame
         * @param {function} func
         * @returns {number}
         */
        nextFrame = root.requestAnimationFrame || root.webkitRequestAnimationFrame || (function() {
            var initial = +new Date,
                last = initial;
            return function(func) {
                return setTimeout(function() {
                    func((last = +new Date) - initial);
                }, 17);
            };
        })(),

        /**
         * Sets up the observation of an object
         * @function doObserve
         * @param {Object} object
         * @param {Handler} handler
         * @param {String[]} [acceptList]
         */
        doObserve = function(object, handler, acceptList) {

            var data = observed.get(object);

            if (data)
                setHandler(object, data, handler, acceptList);
            else {
                data = createObjectData(object);
                setHandler(object, data, handler, acceptList);
                
                if (observed.size === 1)
                    // Let the observation begin!
                    nextFrame(runGlobalLoop);
            }
        },

        /**
         * Creates the initial data for an observed object
         * @function createObjectData
         * @param {Object} object
         */
        createObjectData = function(object, data) {
            var props = getProps(object),
                values = [], descs, i = 0,
                data = {
                    handlers: createMap(),
                    frozen: O.isFrozen ? O.isFrozen(object) : false,
                    extensible: O.isExtensible ? O.isExtensible(object) : true,
                    proto: getPrototype && getPrototype(object),
                    properties: props,
                    values: values,
                    notifier: retrieveNotifier(object, data)
                };

            if (getDescriptor) {
                descs = data.descriptors = [];
                while (i < props.length) {
                    descs[i] = getDescriptor(object, props[i]);
                    values[i] = object[props[i++]];
                }
            } else while (i < props.length)
                values[i] = object[props[i++]];

            observed.set(object, data);

            return data;
        },

        /**
         * Performs basic property value change checks on an observed object
         * @function performPropertyChecks
         * @param {ObjectData} data
         * @param {Object} object
         * @param {String} [except]  Doesn't deliver the changes to the
         *                           handlers that accept this type
         */
        performPropertyChecks = (function() {
            var updateCheck = getDescriptor ? function(object, data, idx, except, descr) {
                var key = data.properties[idx],
                    value = object[key],
                    ovalue = data.values[idx],
                    odesc = data.descriptors[idx];

                if ("value" in descr && (ovalue === value
                        ? ovalue === 0 && 1/ovalue !== 1/value 
                        : ovalue === ovalue || value === value)) {
                    addChangeRecord(object, data, {
                        name: key,
                        type: "update",
                        object: object,
                        oldValue: ovalue
                    }, except);
                    data.values[idx] = value;
                }
                if (odesc.configurable && (!descr.configurable
                        || descr.writable !== odesc.writable
                        || descr.enumerable !== odesc.enumerable
                        || descr.get !== odesc.get
                        || descr.set !== odesc.set)) {
                    addChangeRecord(object, data, {
                        name: key,
                        type: "reconfigure",
                        object: object,
                        oldValue: ovalue
                    }, except);
                    data.descriptors[idx] = descr;
                }
            } : function(object, data, idx, except) {
                var key = data.properties[idx],
                    value = object[key],
                    ovalue = data.values[idx];

                if (ovalue === value ? ovalue === 0 && 1/ovalue !== 1/value 
                        : ovalue === ovalue || value === value) {
                    addChangeRecord(object, data, {
                        name: key,
                        type: "update",
                        object: object,
                        oldValue: ovalue
                    }, except);
                    data.values[idx] = value;
                }
            };

            // Checks if some property has been deleted
            var deletionCheck = getDescriptor ? function(object, props, proplen, data, except) {
                var i = props.length, descr;
                while (proplen && i--) {
                    if (props[i] !== null) {
                        descr = getDescriptor(object, props[i]);
                        proplen--;

                        // If there's no descriptor, the property has really
                        // been deleted; otherwise, it's been reconfigured so
                        // that's not enumerable anymore
                        if (descr) updateCheck(object, data, i, except, descr);
                        else {
                            addChangeRecord(object, data, {
                                name: props[i],
                                type: "delete",
                                object: object,
                                oldValue: data.values[i]
                            }, except);
                            data.properties.splice(i, 1);
                            data.values.splice(i, 1);
                            data.descriptors.splice(i, 1);
                        }
                    }
                }
            } : function(object, props, proplen, data, except) {
                var i = props.length;
                while (proplen && i--)
                    if (props[i] !== null) {
                        addChangeRecord(object, data, {
                            name: props[i],
                            type: "delete",
                            object: object,
                            oldValue: data.values[i]
                        }, except);
                        data.properties.splice(i, 1);
                        data.values.splice(i, 1);
                        proplen--;
                    }
            };

            return function(data, object, except) {
                if (!data.handlers.size || data.frozen) return;

                var props, proplen, keys,
                    values = data.values,
                    descs = data.descriptors,
                    i = 0, idx,
                    key, value,
                    proto, descr;

                // If the object isn't extensible, we don't need to check for new
                // or deleted properties
                if (data.extensible) {

                    props = data.properties.slice();
                    proplen = props.length;
                    keys = getProps(object);

                    if (descs) {
                        while (i < keys.length) {
                            key = keys[i++];
                            idx = inArray(props, key);
                            descr = getDescriptor(object, key);

                            if (idx === -1) {
                                addChangeRecord(object, data, {
                                    name: key,
                                    type: "add",
                                    object: object
                                }, except);
                                data.properties.push(key);
                                values.push(object[key]);
                                descs.push(descr);
                            } else {
                                props[idx] = null;
                                proplen--;
                                updateCheck(object, data, idx, except, descr);
                            }
                        }
                        deletionCheck(object, props, proplen, data, except);

                        if (!O.isExtensible(object)) {
                            data.extensible = false;
                            addChangeRecord(object, data, {
                                type: "preventExtensions",
                                object: object
                            }, except);

                            data.frozen = O.isFrozen(object);
                        }
                    } else {
                        while (i < keys.length) {
                            key = keys[i++];
                            idx = inArray(props, key);
                            value = object[key];

                            if (idx === -1) {
                                addChangeRecord(object, data, {
                                    name: key,
                                    type: "add",
                                    object: object
                                }, except);
                                data.properties.push(key);
                                values.push(value);
                            } else {
                                props[idx] = null;
                                proplen--;
                                updateCheck(object, data, idx, except);
                            }
                        }
                        deletionCheck(object, props, proplen, data, except);
                    }

                } else if (!data.frozen) {

                    // If the object is not extensible, but not frozen, we just have
                    // to check for value changes
                    for (; i < props.length; i++) {
                        key = props[i];
                        updateCheck(object, data, i, except, getDescriptor(object, key));
                    }

                    if (O.isFrozen(object))
                        data.frozen = true;
                }

                if (getPrototype) {
                    proto = getPrototype(object);
                    if (proto !== data.proto) {
                        addChangeRecord(object, data, {
                            type: "setPrototype",
                            name: "__proto__",
                            object: object,
                            oldValue: data.proto
                        });
                        data.proto = proto;
                    }
                }
            };
        })(),

        /**
         * Sets up the main loop for object observation and change notification
         * It stops if no object is observed.
         * @function runGlobalLoop
         */
        runGlobalLoop = function() {
            if (observed.size) {
                observed.forEach(performPropertyChecks);
                handlers.forEach(deliverHandlerRecords);
                nextFrame(runGlobalLoop);
            }
        },

        /**
         * Deliver the change records relative to a certain handler, and resets
         * the record list.
         * @param {HandlerData} hdata
         * @param {Handler} handler
         */
        deliverHandlerRecords = function(hdata, handler) {
            if (hdata.changeRecords.length) {
                handler(hdata.changeRecords);
                hdata.changeRecords = [];
            }
        },

        /**
         * Returns the notifier for an object - whether it's observed or not
         * @function retrieveNotifier
         * @param {Object} object
         * @param {ObjectData} [data]
         * @returns {Notifier}
         */
        retrieveNotifier = function(object, data) {
            if (arguments.length < 2)
                data = observed.get(object);

            /** @type {Notifier} */
            return data && data.notifier || {
                /**
                 * @method notify
                 * @see http://arv.github.io/ecmascript-object-observe/#notifierprototype._notify
                 * @memberof Notifier
                 * @param {ChangeRecord} changeRecord
                 */
                notify: function(changeRecord) {
                    changeRecord.type; // Just to check the property is there...

                    // If there's no data, the object has been unobserved
                    var data = observed.get(object);
                    if (data) {
                        var recordCopy = { object: object }, prop;
                        for (prop in changeRecord)
                            if (prop !== "object")
                                recordCopy[prop] = changeRecord[prop];
                        addChangeRecord(object, data, recordCopy);
                    }
                },

                /**
                 * @method performChange
                 * @see http://arv.github.io/ecmascript-object-observe/#notifierprototype_.performchange
                 * @memberof Notifier
                 * @param {String} changeType
                 * @param {Performer} func     The task performer
                 * @param {*} [thisObj]        Used to set `this` when calling func
                 */
                performChange: function(changeType, func/*, thisObj*/) {
                    if (typeof changeType !== "string")
                        throw new TypeError("Invalid non-string changeType");

                    if (typeof func !== "function")
                        throw new TypeError("Cannot perform non-function");

                    // If there's no data, the object has been unobserved
                    var data = observed.get(object),
                        prop, changeRecord,
                        result = func.call(arguments[2]);

                    data && performPropertyChecks(data, object, changeType);

                    // If there's no data, the object has been unobserved
                    if (data && result && typeof result === "object") {
                        changeRecord = { object: object, type: changeType };
                        for (prop in result)
                            if (prop !== "object" && prop !== "type")
                                changeRecord[prop] = result[prop];
                        addChangeRecord(object, data, changeRecord);
                    }
                }
            };
        },

        /**
         * Register (or redefines) an handler in the collection for a given
         * object and a given type accept list.
         * @function setHandler
         * @param {Object} object
         * @param {ObjectData} data
         * @param {Handler} handler
         * @param {String[]} acceptList
         */
        setHandler = function(object, data, handler, acceptList) {
            var hdata = handlers.get(handler);
            if (!hdata)
                handlers.set(handler, hdata = {
                    observed: createMap(),
                    changeRecords: []
                });
            hdata.observed.set(object, {
                acceptList: acceptList.slice(),
                data: data
            });
            data.handlers.set(handler, hdata);
        },

        /**
         * Adds a change record in a given ObjectData
         * @function addChangeRecord
         * @param {Object} object
         * @param {ObjectData} data
         * @param {ChangeRecord} changeRecord
         * @param {String} [except]
         */
        addChangeRecord = function(object, data, changeRecord, except) {
            data.handlers.forEach(function(hdata) {
                var acceptList = hdata.observed.get(object).acceptList;
                // If except is defined, Notifier.performChange has been
                // called, with except as the type.
                // All the handlers that accepts that type are skipped.
                if ((typeof except !== "string"
                        || inArray(acceptList, except) === -1)
                        && inArray(acceptList, changeRecord.type) > -1)
                    hdata.changeRecords.push(changeRecord);
            });
        };

    observed = createMap();
    handlers = createMap();

    /**
     * @function Object.observe
     * @see http://arv.github.io/ecmascript-object-observe/#Object.observe
     * @param {Object} object
     * @param {Handler} handler
     * @param {String[]} [acceptList]
     * @throws {TypeError}
     * @returns {Object}               The observed object
     */
    O.observe = function observe(object, handler, acceptList) {
        if (!object || typeof object !== "object" && typeof object !== "function")
            throw new TypeError("Object.observe cannot observe non-object");

        if (typeof handler !== "function")
            throw new TypeError("Object.observe cannot deliver to non-function");

        if (O.isFrozen && O.isFrozen(handler))
            throw new TypeError("Object.observe cannot deliver to a frozen function object");

        if (typeof acceptList === "undefined")
            acceptList = defaultAcceptList;
        else if (!acceptList || typeof acceptList !== "object")
            throw new TypeError("Third argument to Object.observe must be an array of strings.");

        doObserve(object, handler, acceptList);

        return object;
    };

    /**
     * @function Object.unobserve
     * @see http://arv.github.io/ecmascript-object-observe/#Object.unobserve
     * @param {Object} object
     * @param {Handler} handler
     * @throws {TypeError}
     * @returns {Object}         The given object
     */
    O.unobserve = function unobserve(object, handler) {
        if (object === null || typeof object !== "object" && typeof object !== "function")
            throw new TypeError("Object.unobserve cannot unobserve non-object");

        if (typeof handler !== "function")
            throw new TypeError("Object.unobserve cannot deliver to non-function");

        var hdata = handlers.get(handler), odata;

        if (hdata && (odata = hdata.observed.get(object))) {
            hdata.observed.forEach(function(odata, object) {
                performPropertyChecks(odata.data, object);
            });
            nextFrame(function() {
                deliverHandlerRecords(hdata, handler);
            });

            // In Firefox 13-18, size is a function, but createMap should fall
            // back to the shim for those versions
            if (hdata.observed.size === 1 && hdata.observed.has(object))
                handlers["delete"](handler);
            else hdata.observed["delete"](object);

            if (odata.data.handlers.size === 1)
                observed["delete"](object);
            else odata.data.handlers["delete"](handler);
        }

        return object;
    };

    /**
     * @function Object.getNotifier
     * @see http://arv.github.io/ecmascript-object-observe/#GetNotifier
     * @param {Object} object
     * @throws {TypeError}
     * @returns {Notifier}
     */
    O.getNotifier = function getNotifier(object) {
        if (object === null || typeof object !== "object" && typeof object !== "function")
            throw new TypeError("Object.getNotifier cannot getNotifier non-object");

        if (O.isFrozen && O.isFrozen(object)) return null;

        return retrieveNotifier(object);
    };

    /**
     * @function Object.deliverChangeRecords
     * @see http://arv.github.io/ecmascript-object-observe/#Object.deliverChangeRecords
     * @see http://arv.github.io/ecmascript-object-observe/#DeliverChangeRecords
     * @param {Handler} handler
     * @throws {TypeError}
     */
    O.deliverChangeRecords = function deliverChangeRecords(handler) {
        if (typeof handler !== "function")
            throw new TypeError("Object.deliverChangeRecords cannot deliver to non-function");

        var hdata = handlers.get(handler);
        if (hdata) {
            hdata.observed.forEach(function(odata, object) {
                performPropertyChecks(odata.data, object);
            });
            deliverHandlerRecords(hdata, handler);
        }
    };

})(Object, Array, this);
}).call(this,require("oMfpAn"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../../node_modules/object.observe/dist/object-observe.js","/../../node_modules/object.observe/dist")
},{"buffer":1,"oMfpAn":4}],6:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
'use strict';

module.exports = (function () {

    var depthString = '                                                                                ';

    function DataNodeBase(key) {
        this.label = key;
        this.data = [''];
        this.rowIndexes = [];
        this.hasChildren = false;
        this.depth = 0;
        this.height = 1;
        this.expanded = false;
    }

    DataNodeBase.prototype.isNullObject = false;

    DataNodeBase.prototype.getValue = function (x) {
        return this.data[x];
    };

    DataNodeBase.prototype.prune = function (depth) {
        this.depth = depth;
        this.data[0] = this.computeDepthString();
    };

    DataNodeBase.prototype.computeDepthString = function () {
        var string = depthString.substring(0, 2 + (this.depth * 3)) + this.label;
        return string;
    };

    DataNodeBase.prototype.computeHeight = function () {
        return 1;
    };

    DataNodeBase.prototype.getAllRowIndexes = function () {
        return this.rowIndexes;
    };

    DataNodeBase.prototype.computeAggregates = function (aggregator) {
        this.applyAggregates(aggregator);
    };

    DataNodeBase.prototype.applyAggregates = function (aggregator) {
        var hasGroupsOffset = aggregator.hasGroups() ? 1 : 0;
        var indexes = this.getAllRowIndexes();
        if (indexes.length === 0) {
            return; // no data to rollup on
        }
        var aggregates = aggregator.aggregates;
        var data = this.data;
        data.length = aggregates.length + hasGroupsOffset;

        var sorter = aggregator.sorterInstance;
        sorter.indexes = indexes;

        for (var i = 0; i < aggregates.length; i++) {
            var aggregate = aggregates[i];
            data[i + hasGroupsOffset] = aggregate(sorter);
        }

        this.data = data;
    };

    DataNodeBase.prototype.buildView = function (aggregator) {
        aggregator.view.push(this);
    };

    DataNodeBase.prototype.toggleExpansionState = function () { /* aggregator */
        //do nothing by default
    };

    return DataNodeBase;

})();

}).call(this,require("oMfpAn"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/DataNodeBase.js","/")
},{"buffer":1,"oMfpAn":4}],7:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
'use strict';

var Map = require('./Map');
var DataNodeBase = require('./DataNodeBase');

module.exports = (function () {

    var ExpandedMap = {
        true: '▾',
        false: '▸'
    };
    var depthString = '                                                                                ';

    function DataNodeGroup(key) {
        DataNodeBase.call(this, key);
        this.children = new Map();
    }

    DataNodeGroup.prototype = Object.create(DataNodeBase.prototype);

    DataNodeGroup.prototype.prune = function (depth) {
        this.depth = depth;
        this.children = this.children.values;
        for (var i = 0; i < this.children.length; i++) {
            var child = this.children[i];
            child.prune(this.depth + 1);
        }
        this.data[0] = this.computeDepthString();
    };

    DataNodeGroup.prototype.computeDepthString = function () {
        var icon = ExpandedMap[this.expanded + ''];
        var string = depthString.substring(0, this.depth * 3) + icon + ' ' + this.label;
        return string;
    };

    DataNodeGroup.prototype.getAllRowIndexes = function () {
        if (this.rowIndexes.length === 0) {
            this.rowIndexes = this.computeAllRowIndexes();
        }
        return this.rowIndexes;
    };

    DataNodeGroup.prototype.computeAllRowIndexes = function () {
        var result = [];
        for (var i = 0; i < this.children.length; i++) {
            var child = this.children[i];
            var childIndexes = child.getAllRowIndexes();
            Array.prototype.splice.apply(result, [result.length, 0].concat(childIndexes));
        }
        return result;
    };

    DataNodeGroup.prototype.toggleExpansionState = function (aggregator) { /* aggregator */
        this.expanded = !this.expanded;
        this.data[0] = this.computeDepthString();
        if (this.expanded) {
            this.computeAggregates(aggregator);
        }
    };

    DataNodeGroup.prototype.computeAggregates = function (aggregator) {
        this.applyAggregates(aggregator);
        if (!this.expanded) {
            return; // were not being viewed, don't have child nodes do computation;
        }
        for (var i = 0; i < this.children.length; i++) {
            this.children[i].computeAggregates(aggregator);
        }
    };

    DataNodeGroup.prototype.buildView = function (aggregator) {
        aggregator.view.push(this);
        if (this.expanded) {
            for (var i = 0; i < this.children.length; i++) {
                var child = this.children[i];
                child.buildView(aggregator);
            }
        }
    };

    DataNodeGroup.prototype.computeHeight = function () {
        var height = 1; //I'm 1 high
        if (!this.expanded) {
            this.height = 1;
        } else {
            for (var i = 0; i < this.children.length; i++) {
                height = height + this.children[i].computeHeight();
            }
            this.height = height;
        }
        return this.height;
    };

    return DataNodeGroup;

})();
}).call(this,require("oMfpAn"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/DataNodeGroup.js","/")
},{"./DataNodeBase":6,"./Map":17,"buffer":1,"oMfpAn":4}],8:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
'use strict';

var DataNodeBase = require('./DataNodeBase');

module.exports = (function () {

    function DataNodeLeaf(key) {
        DataNodeBase.call(this, key);
    }

    DataNodeLeaf.prototype = Object.create(DataNodeBase.prototype);

    DataNodeLeaf.prototype.prune = function (depth) {
        this.depth = depth;
        this.data[0] = this.computeDepthString();
    };

    DataNodeLeaf.prototype.computeHeight = function () {
        return 1;
    };

    DataNodeLeaf.prototype.getAllRowIndexes = function () {
        return this.rowIndexes;
    };

    DataNodeLeaf.prototype.computeAggregates = function (aggregator) {
        this.applyAggregates(aggregator);
    };

    DataNodeLeaf.prototype.buildView = function (aggregator) {
        aggregator.view.push(this);
    };

    return DataNodeLeaf;

})();
}).call(this,require("oMfpAn"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/DataNodeLeaf.js","/")
},{"./DataNodeBase":6,"buffer":1,"oMfpAn":4}],9:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
'use strict';

var DataNodeGroup = require('./DataNodeGroup');

module.exports = (function () {

    function DataNodeTree(key) {
        DataNodeGroup.call(this, key);
        this.height = 0;
        this.expanded = true;
    }

    DataNodeTree.prototype = Object.create(DataNodeGroup.prototype);

    DataNodeTree.prototype.prune = function () {
        this.children = this.children.values;
        for (var i = 0; i < this.children.length; i++) {
            var child = this.children[i];
            child.prune(0);
        }
    };

    DataNodeTree.prototype.buildView = function (aggregator) {
        for (var i = 0; i < this.children.length; i++) {
            var child = this.children[i];
            child.buildView(aggregator);
        }
    };

    DataNodeTree.prototype.computeHeight = function () {
        var height = 1;
        for (var i = 0; i < this.children.length; i++) {
            height = height + this.children[i].computeHeight();
        }
        this.height = height;

        return this.height;
    };


    return DataNodeTree;

})();

}).call(this,require("oMfpAn"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/DataNodeTree.js","/")
},{"./DataNodeGroup":7,"buffer":1,"oMfpAn":4}],10:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
'use strict';

var DataSourceSorter = require('./DataSourceSorter');
var DataNodeTree = require('./DataNodeTree');
var DataNodeGroup = require('./DataNodeGroup');
var DataNodeLeaf = require('./DataNodeLeaf');
var DataNodeLeaf = require('./DataNodeLeaf');
var Aggregations = require('./aggregations');

module.exports = (function () {

    var headerify = function (string) {
        var pieces = string.replace(/[_-]/g, ' ').replace(/[A-Z]/g, ' $&').split(' ').map(function (s) {
            return (s.charAt(0).toUpperCase() + s.slice(1)).trim();
        });
        pieces = pieces.filter(function (e) {
            return e.length !== 0;
        });
        return pieces.join(' ').trim();
    };

    //?[t,c,b,a]
    // t is a dataSource,
    // a is a dicitionary of aggregates,  columnName:function
    // b is a dicitionary of groupbys, columnName:sourceColumnName
    // c is a list of constraints,

    function DataSourceAggregator(dataSource) {
        this.tree = new DataNodeTree('Totals');
        this.indexes = [];
        this.dataSource = dataSource;
        this.aggregates = [];
        this.headers = [];
        this.groupBys = [];
        this.view = [];
        this.sorterInstance = {};
        this.presortGroups = true;
        this.lastAggregate = {};
        this.setAggregates({});
    }

    DataSourceAggregator.prototype.isNullObject = false;

    DataSourceAggregator.prototype.setAggregates = function(aggregations) {
        this.lastAggregate = aggregations;
        var props = [];
        var i;
        this.clearAggregations();
        this.headers.length = 0;

        for (var key in aggregations) {
            props.push([key, aggregations[key]]);
        }

        // if (props.length === 0) {
        //     var fields = [].concat(this.dataSource.getFields());
        //     for (i = 0; i < fields.length; i++) {
        //         props.push([fields[i], Aggregations.first(i)]); /* jshint ignore:line */
        //     }
        // }

        if(this.hasGroups()) {
            this.headers.push('Tree');
        }

        for (i = 0; i < props.length; i++) {
            var agg = props[i];
            this.addAggregate(agg[0], agg[1]);
        }
    };

    DataSourceAggregator.prototype.addAggregate = function(label, func) {
        this.headers.push(headerify(label));
        this.aggregates.push(func);
    };

    DataSourceAggregator.prototype.setGroupBys = function (columnIndexArray) {
        this.groupBys.length = 0;
        for (var i = 0; i < columnIndexArray.length; i++) {
            this.groupBys.push(columnIndexArray[i]);
        }
        this.setAggregates(this.lastAggregate);
    };

    DataSourceAggregator.prototype.addGroupBy = function(index) {
            this.groupBys.push(index);
    };

    DataSourceAggregator.prototype.hasGroups = function () {
        return this.groupBys.length > 0;
    };

    DataSourceAggregator.prototype.hasAggregates = function () {
        return this.aggregates.length > 0;
    };

    DataSourceAggregator.prototype.apply = function () {
        this.buildGroupTree();
    };

    DataSourceAggregator.prototype.clearGroups = function () {
        this.groupBys.length = 0;
    };

    DataSourceAggregator.prototype.clearAggregations = function () {
        this.aggregates.length = 0;
        this.headers.length = 0;
    };

    DataSourceAggregator.prototype.buildGroupTree = function () {
        var c, r, g, value, createFunc;
        var createBranch = function (key, map) {
            value = new DataNodeGroup(key);
            map.set(key, value);
            return value;
        };
        var createLeaf = function (key, map) {
            value = new DataNodeLeaf(key);
            map.set(key, value);
            return value;
        };
        var groupBys = this.groupBys;
        var source = this.dataSource;
        var rowCount = source.getRowCount();

        // lets sort our data first....
        if (this.presortGroups) {
            for (c = 0; c < groupBys.length; c++) {
                g = groupBys[groupBys.length - c - 1];
                source = new DataSourceSorter(source);
                source.sortOn(g);
            }
        }

        var tree = this.tree = new DataNodeTree('root');
        var path = tree;
        var leafDepth = groupBys.length - 1;
        for (r = 0; r < rowCount; r++) {
            for (c = 0; c < groupBys.length; c++) {
                g = groupBys[c];
                value = source.getValue(g, r);

                //test that I'm not a leaf
                createFunc = (c === leafDepth) ? createLeaf : createBranch;
                path = path.children.getIfAbsent(value, createFunc);
            }
            path.rowIndexes.push(r);
            path = tree;
        }
        this.sorterInstance = new DataSourceSorter(source);
        tree.prune();
        this.tree.computeAggregates(this);
        this.buildView();
    };

    DataSourceAggregator.prototype.buildView = function () {
        this.view.length = 0;
        this.tree.computeHeight();
        this.tree.buildView(this);
    };

    DataSourceAggregator.prototype.viewMakesSense = function () {
        return this.hasAggregates();
    };

    DataSourceAggregator.prototype.getValue = function (x, y) {
        if (!this.viewMakesSense()) {
            return this.dataSource.getValue(x, y);
        }
        var row = this.view[y];
        if (!row) {
            return null;
        }
        return row.getValue(x);
    };

    DataSourceAggregator.prototype.setValue = function (x, y, value) {
        if (!this.viewMakesSense()) {
            return this.dataSource.setValue(x, y, value);
        }
    };

    DataSourceAggregator.prototype.getColumnCount = function () {
        if (!this.viewMakesSense()) {
            return this.dataSource.getColumnCount();
        }
        var colCount = this.getHeaders().length;
        return colCount;
    };

    DataSourceAggregator.prototype.getRowCount = function () {
        if (!this.viewMakesSense()) {
            return this.dataSource.getRowCount();
        }
        return this.view.length; //header column
    };

    DataSourceAggregator.prototype.click = function (y) {
        var group = this.view[y];
        group.toggleExpansionState(this);
        this.buildView();
    };

    DataSourceAggregator.prototype.getHeaders = function () {
        if (!this.viewMakesSense()) {
            return this.dataSource.getHeaders();
        }
        return this.headers;
    };

    DataSourceAggregator.prototype.setHeaders = function (headers) {
        this.dataSource.setHeaders(headers);
    };

    DataSourceAggregator.prototype.getFields = function () {
        return this.dataSource.getFields();
    };

    DataSourceAggregator.prototype.setFields = function (fields) {
        return this.dataSource.setFields(fields);
    };

    DataSourceAggregator.prototype.getGrandTotals = function () {
        var view = this.tree;
        return [view.data];
    };

    DataSourceAggregator.prototype.getRow = function (y) {

        if (!this.viewMakesSense()) {
            return this.dataSource.getRow(y);
        }

        var rollups = this.view[y + 1];
        if (!rollups) {
            return this.tree;
        }

        return rollups;
    };

    DataSourceAggregator.prototype.setData = function (arrayOfUniformObjects) {
        this.dataSource.setData(arrayOfUniformObjects);
        this.apply();
    };

    return DataSourceAggregator;

})();

}).call(this,require("oMfpAn"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/DataSourceAggregator.js","/")
},{"./DataNodeGroup":7,"./DataNodeLeaf":8,"./DataNodeTree":9,"./DataSourceSorter":14,"./aggregations":19,"buffer":1,"oMfpAn":4}],11:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
'use strict';

module.exports = (function () {

    function DataSourceDecorator(dataSource) {
        this.dataSource = dataSource;
        this.indexes = [];
    }

    DataSourceDecorator.prototype.isNullObject = false;

    DataSourceDecorator.prototype.transposeY = function (y) {
        if (this.indexes.length !== 0) {
            return this.indexes[y];
        }
        return y;
    };

    DataSourceDecorator.prototype.getValue = function (x, y) {
        var value = this.dataSource.getValue(x, this.transposeY(y));
        return value;
    };

    DataSourceDecorator.prototype.getRow = function (y) {

        return this.dataSource.getRow(this.transposeY(y));
    };

    DataSourceDecorator.prototype.setValue = function (x, y, value) {

        this.dataSource.setValue(x, this.transposeY(y), value);
    };

    DataSourceDecorator.prototype.getColumnCount = function () {

        return this.dataSource.getColumnCount();
    };

    DataSourceDecorator.prototype.getFields = function () {

        return this.dataSource.getFields();
    };

    DataSourceDecorator.prototype.setFields = function (fields) {

        return this.dataSource.setFields(fields);
    };

    DataSourceDecorator.prototype.getRowCount = function () {
        if (this.indexes.length !== 0) {
            return this.indexes.length;
        }
        return this.dataSource.getRowCount();
    };

    DataSourceDecorator.prototype.setHeaders = function (headers) {
        return this.dataSource.setHeaders(headers);
    };

    DataSourceDecorator.prototype.getHeaders = function () {

        return this.dataSource.getHeaders();
    };

    DataSourceDecorator.prototype.getGrandTotals = function () {
        //nothing here
        return;
    };

    DataSourceDecorator.prototype.initializeIndexVector = function () {
        var rowCount = this.dataSource.getRowCount();
        var indexVector = new Array(rowCount);
        for (var r = 0; r < rowCount; r++) {
            indexVector[r] = r;
        }
        this.indexes = indexVector;
    };

    DataSourceDecorator.prototype.setData = function (arrayOfUniformObjects) {
        this.dataSource.setData(arrayOfUniformObjects);
    };

    return DataSourceDecorator;

})();
}).call(this,require("oMfpAn"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/DataSourceDecorator.js","/")
},{"buffer":1,"oMfpAn":4}],12:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
'use strict';

var DataSourceDecorator = require('./DataSourceDecorator');

module.exports = (function () {

    function DataSourceFilter(dataSource) {
        DataSourceDecorator.call(this, dataSource, false);
        this.filters = [];
    }

    DataSourceFilter.prototype = Object.create(DataSourceDecorator.prototype);

    DataSourceFilter.prototype.addFilter = function (columnIndex, filter) {
        filter.columnIndex = columnIndex;
        this.filters.push(filter);
    };
    DataSourceFilter.prototype.setFilter = function (columnIndex, filter) {
        filter.columnIndex = columnIndex;
        this.filters.push(filter);
    };

    DataSourceFilter.prototype.clearFilters = function () { /* filter */
        this.filters.length = 0;
        this.indexes.length = 0;
    };

    DataSourceFilter.prototype.applyFilters = function () {
        if (this.filters.length === 0) {
            this.indexes.length = 0;
            return;
        }
        var indexes = this.indexes;
        indexes.length = 0;
        var count = this.dataSource.getRowCount();
        for (var r = 0; r < count; r++) {
            if (this.applyFiltersTo(r)) {
                indexes.push(r);
            }
        }
    };

    DataSourceFilter.prototype.applyFiltersTo = function (r) {
        var filters = this.filters;
        var isFiltered = true;
        for (var f = 0; f < filters.length; f++) {
            var filter = filters[f];
            var rowObject = this.dataSource.getRow(r);
            isFiltered = isFiltered && filter(this.dataSource.getValue(filter.columnIndex, r), rowObject, r);
        }
        return isFiltered;
    };

    return DataSourceFilter;

})();
}).call(this,require("oMfpAn"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/DataSourceFilter.js","/")
},{"./DataSourceDecorator":11,"buffer":1,"oMfpAn":4}],13:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
'use strict';

var DataSourceDecorator = require('./DataSourceDecorator');

module.exports = (function () {

    function DataSourceGlobalFilter(dataSource) {
        DataSourceDecorator.call(this, dataSource, false);
        this.filter = null;
    }

    DataSourceGlobalFilter.prototype = Object.create(DataSourceDecorator.prototype);

    DataSourceGlobalFilter.prototype.setFilter = function (filter) {
        this.filter = filter;
    };

    DataSourceGlobalFilter.prototype.clearFilters = function () { /* filter */
        this.filter = null;
        this.indexes.length = 0;
    };

    DataSourceGlobalFilter.prototype.applyFilters = function () {
        if (!this.filter) {
            this.indexes.length = 0;
            return;
        }
        var indexes = this.indexes;
        indexes.length = 0;
        var count = this.dataSource.getRowCount();
        for (var r = 0; r < count; r++) {
            if (this.applyFilterTo(r)) {
                indexes.push(r);
            }
        }
    };

    DataSourceGlobalFilter.prototype.applyFilterTo = function (r) {
        var isFiltered = false;
        var filter = this.filter;
        var colCount = this.getColumnCount();
        var rowObject = this.dataSource.getRow(r);
        for (var i = 0; i < colCount; i++) {
            isFiltered = isFiltered || filter(this.dataSource.getValue(i, r), rowObject, r);
            if (isFiltered) {
                return true;
            }
        }
        return false;
    };

    return DataSourceGlobalFilter;

})();
}).call(this,require("oMfpAn"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/DataSourceGlobalFilter.js","/")
},{"./DataSourceDecorator":11,"buffer":1,"oMfpAn":4}],14:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
'use strict';

var Utils = require('./Utils.js');
var DataSourceDecorator = require('./DataSourceDecorator');

module.exports = (function () {

    function DataSourceSorter(dataSource) {
        DataSourceDecorator.call(this, dataSource);
        this.descendingSort = false;
    }

    DataSourceSorter.prototype = Object.create(DataSourceDecorator.prototype);

    DataSourceSorter.prototype.sortOn = function (columnIndex, sortType) {
        if (sortType === 0) {
            this.indexes.length = 0;
            return;
        }
        this.initializeIndexVector();
        var self = this;
        Utils.stableSort(this.indexes, function (index) {
            return self.dataSource.getValue(columnIndex, index);
        }, sortType);
    };

    return DataSourceSorter;

})();
}).call(this,require("oMfpAn"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/DataSourceSorter.js","/")
},{"./DataSourceDecorator":11,"./Utils.js":18,"buffer":1,"oMfpAn":4}],15:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
'use strict';

var DataSourceDecorator = require('./DataSourceDecorator');
var DataSourceSorter = require('./DataSourceSorter');

module.exports = (function () {

    function DataSourceSorterComposite(dataSource) {
        DataSourceDecorator.call(this, dataSource);
        this.sorts = [];
        this.last = this.dataSource;
    }

    DataSourceSorterComposite.prototype = Object.create(DataSourceDecorator.prototype);

    DataSourceSorterComposite.prototype.sortOn = function (columnIndex, sortType) {
        this.sorts.push([columnIndex, sortType]);
    };

    DataSourceSorterComposite.prototype.applySorts = function () {
        var sorts = this.sorts;
        var each = this.dataSource;
        for (var i = 0; i < sorts.length; i++) {
            var sort = sorts[i];
            each = new DataSourceSorter(each);
            each.sortOn(sort[0], sort[1]);
        }
        this.last = each;
    };

    DataSourceSorterComposite.prototype.clearSorts = function () {
        this.sorts.length = 0;
        this.last = this.dataSource;
    };

    DataSourceSorterComposite.prototype.getValue = function (x, y) {
        return this.last.getValue(x, y);
    };

    DataSourceSorterComposite.prototype.setValue = function (x, y, value) {
        this.last.setValue(x, y, value);
    };

    return DataSourceSorterComposite;

})();
}).call(this,require("oMfpAn"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/DataSourceSorterComposite.js","/")
},{"./DataSourceDecorator":11,"./DataSourceSorter":14,"buffer":1,"oMfpAn":4}],16:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
'use strict';

module.exports = (function () {

    var headerify = function (string) {
        var pieces = string.replace(/[_-]/g, ' ').replace(/[A-Z]/g, ' $&').split(' ').map(function (s) {
            return s.charAt(0).toUpperCase() + s.slice(1);
        });
        return pieces.join(' ');
    };

    var computeFieldNames = function (object) {
        if (!object) {
            return [];
        }
        var fields = [].concat(Object.getOwnPropertyNames(object).filter(function (e) {
            return e.substr(0, 2) !== '__';
        }));
        return fields;
    };

    function JSDataSource(data, fields) {
        this.fields = fields || computeFieldNames(data[0]);
        this.headers = [];
        this.data = data;
    }

    JSDataSource.prototype.isNullObject = false;

    JSDataSource.prototype.getValue = function (x, y) {
        var row = this.data[y];
        if (!row) {
            return null;
        }
        var value = row[this.fields[x]];
        return value;
    };

    JSDataSource.prototype.getRow = function (y) {

        return this.data[y];
    };

    JSDataSource.prototype.setValue = function (x, y, value) {

        this.data[y][this.fields[x]] = value;
    };

    JSDataSource.prototype.getColumnCount = function () {

        return this.getFields().length;
    };

    JSDataSource.prototype.getRowCount = function () {

        return this.data.length;
    };

    JSDataSource.prototype.getFields = function () {

        return this.fields;
    };

    JSDataSource.prototype.getHeaders = function () {
        if (!this.headers || this.headers.length === 0) {
            this.headers = this.getDefaultHeaders().map(function (each) {
                return headerify(each);
            });
        }
        return this.headers;
    };

    JSDataSource.prototype.getDefaultHeaders = function () {

        return this.getFields();
    };

    JSDataSource.prototype.setFields = function (fields) {

        this.fields = fields;
    };

    JSDataSource.prototype.setHeaders = function (headers) {

        this.headers = headers;
    };

    JSDataSource.prototype.getGrandTotals = function () {
        //nothing here
        return;
    };

    JSDataSource.prototype.setData = function (arrayOfUniformObjects) {
        this.data = arrayOfUniformObjects;
    };

    return JSDataSource;

})();

}).call(this,require("oMfpAn"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/JSDataSource.js","/")
},{"buffer":1,"oMfpAn":4}],17:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
'use strict';

module.exports = (function () {

    var oidPrefix = '.~.#%_'; //this should be something we never will see at the begining of a string
    var counter = 0;

    var hash = function (key) {
        var typeOf = typeof key;
        switch (typeOf) {
        case 'number':
            return oidPrefix + typeOf + '_' + key;
        case 'string':
            return oidPrefix + typeOf + '_' + key;
        case 'boolean':
            return oidPrefix + typeOf + '_' + key;
        case 'symbol':
            return oidPrefix + typeOf + '_' + key;
        case 'undefined':
            return oidPrefix + 'undefined';
        case 'object':
            /*eslint-disable */
            if (key.___finhash) {
                return key.___finhash;
            }
            key.___finhash = oidPrefix + counter++;
            return key.___finhash;
        case 'function':
            if (key.___finhash) {
                return key.___finhash;
            }
            key.___finhash = oidPrefix + counter++;
            return key.___finhash; /*eslint-enable */
        }
    };

    // Object.is polyfill, courtesy of @WebReflection
    var is = Object.is ||
    function (a, b) {
        return a === b ? a !== 0 || 1 / a == 1 / b : a != a && b != b; // eslint-disable-line
    };

    // More reliable indexOf, courtesy of @WebReflection
    var betterIndexOf = function (arr, value) {
        if (value != value || value === 0) { // eslint-disable-line
            for (var i = arr.length; i-- && !is(arr[i], value);) { // eslint-disable-line
            }
        } else {
            i = [].indexOf.call(arr, value);
        }
        return i;
    };

    function Mappy() {
        this.keys = [];
        this.data = {};
        this.values = [];
    }

    Mappy.prototype.set = function (key, value) {
        var hashCode = hash(key);
        if (this.data[hashCode] === undefined) {
            this.keys.push(key);
            this.values.push(value);
        }
        this.data[hashCode] = value;
    };

    Mappy.prototype.get = function (key) {
        var hashCode = hash(key);
        return this.data[hashCode];
    };

    Mappy.prototype.getIfAbsent = function (key, ifAbsentFunc) {
        var value = this.get(key);
        if (value === undefined) {
            value = ifAbsentFunc(key, this);
        }
        return value;
    };

    Mappy.prototype.size = function () {
        return this.keys.length;
    };

    Mappy.prototype.clear = function () {
        this.keys.length = 0;
        this.data = {};
    };

    Mappy.prototype.delete = function (key) {
        var hashCode = hash(key);
        if (this.data[hashCode] === undefined) {
            return;
        }
        var index = betterIndexOf(this.keys, key);
        this.keys.splice(index, 1);
        this.values.splice(index, 1);
        delete this.data[hashCode];
    };

    Mappy.prototype.forEach = function (func) {
        var keys = this.keys;
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var value = this.get(key);
            func(value, key, this);
        }
    };

    Mappy.prototype.map = function (func) {
        var keys = this.keys;
        var newMap = new Mappy();
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var value = this.get(key);
            var transformed = func(value, key, this);
            newMap.set(key, transformed);
        }
        return newMap;
    };

    Mappy.prototype.copy = function () {
        var keys = this.keys;
        var newMap = new Mappy();
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var value = this.get(key);
            newMap.set(key, value);
        }
        return newMap;
    };

    return Mappy;

})();
}).call(this,require("oMfpAn"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/Map.js","/")
},{"buffer":1,"oMfpAn":4}],18:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
'use strict';

var stableSort = require('./stableSort.js');
var Map = require('./Map.js');

module.exports = (function () {

    return {
        stableSort: stableSort,
        Map: Map
    };

})();
}).call(this,require("oMfpAn"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/Utils.js","/")
},{"./Map.js":17,"./stableSort.js":22,"buffer":1,"oMfpAn":4}],19:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
'use strict';

module.exports = (function () {

    return {

        count: function () { /* columIndex */
            return function (group) {
                var rows = group.getRowCount();
                return rows;
            };
        },

        sum: function (columIndex) {
            return function (group) {
                var sum = 0;
                var rows = group.getRowCount();
                for (var r = 0; r < rows; r++) {
                    sum = sum + group.getValue(columIndex, r);
                }
                return sum;
            };
        },

        min: function (columIndex) {
            return function (group) {
                var min = 0;
                var rows = group.getRowCount();
                for (var r = 0; r < rows; r++) {
                    min = Math.min(min, group.getValue(columIndex, r));
                }
                return min;
            };
        },


        max: function (columIndex) {
            return function (group) {
                var max = 0;
                var rows = group.getRowCount();
                for (var r = 0; r < rows; r++) {
                    max = Math.max(max, group.getValue(columIndex, r));
                }
                return max;
            };
        },

        avg: function (columIndex) {
            return function (group) {
                var sum = 0;
                var rows = group.getRowCount();
                for (var r = 0; r < rows; r++) {
                    sum = sum + group.getValue(columIndex, r);
                }
                return sum / rows;
            };
        },

        first: function (columIndex) {
            return function (group) {
                return group.getValue(columIndex, 0);
            };
        },

        last: function (columIndex) {
            return function (group) {
                var rows = group.getRowCount();
                return group.getValue(columIndex, rows - 1);
            };
        },

        stddev: function (columIndex) {
            return function (group) {
                var r;
                var sum = 0;
                var rows = group.getRowCount();
                for (r = 0; r < rows; r++) {
                    sum = sum + group.getValue(columIndex, r);
                }
                var mean = sum / rows;
                var variance = 0;
                for (r = 0; r < rows; r++) {
                    var dev = (group.getValue(columIndex, r) - mean);
                    variance = variance + (dev * dev);
                }
                var stddev = Math.sqrt(variance / rows);
                return stddev;
            };
        }
    };

})();
}).call(this,require("oMfpAn"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/aggregations.js","/")
},{"buffer":1,"oMfpAn":4}],20:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
'use strict';

var JSDataSource = require('./JSDataSource');
var DataSourceSorter = require('./DataSourceSorter');
var DataSourceSorterComposite = require('./DataSourceSorterComposite');
var DataSourceFilter = require('./DataSourceFilter');
var DataSourceGlobalFilter = require('./DataSourceGlobalFilter');
var DataSourceAggregator = require('./DataSourceAggregator');
var aggregations = require('./aggregations');

module.exports = (function () {

    return {
        JSDataSource: JSDataSource,
        DataSourceSorter: DataSourceSorter,
        DataSourceSorterComposite: DataSourceSorterComposite,
        DataSourceFilter: DataSourceFilter,
        DataSourceGlobalFilter: DataSourceGlobalFilter,
        DataSourceAggregator: DataSourceAggregator,
        aggregations: aggregations
    };

})();
}).call(this,require("oMfpAn"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/analytics.js","/")
},{"./DataSourceAggregator":10,"./DataSourceFilter":12,"./DataSourceGlobalFilter":13,"./DataSourceSorter":14,"./DataSourceSorterComposite":15,"./JSDataSource":16,"./aggregations":19,"buffer":1,"oMfpAn":4}],21:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
/* eslint-env node, browser */
'use strict';

var noop = function () {};

var oo = require('object.observe');
var analytics = require('./analytics.js');

noop(oo);

if (!window.fin) {
    window.fin = {};
}
if (!window.fin.analytics) {
    window.fin.analytics = analytics;
}
}).call(this,require("oMfpAn"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/fake_1a32a68a.js","/")
},{"./analytics.js":20,"buffer":1,"oMfpAn":4,"object.observe":5}],22:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
'use strict';

var stabilize = function (comparator, descending) {
    return function (arr1, arr2) {
        var x = arr1[0];
        var y = arr2[0];
        if (x === y) {
            x = descending ? arr2[1] : arr1[1];
            y = descending ? arr1[1] : arr2[1];
        } else {
            if (y === null) {
                return -1;
            }
            if (x === null) {
                return 1;
            }
        }
        return comparator(x, y);
    };
};


var ascendingNumbers = function (x, y) {
    return x - y;
};

var descendingNumbers = function (x, y) {
    return y - x;
};

var ascendingAllOthers = function (x, y) {
    return x < y ? -1 : 1;
};

var descendingAllOthers = function (x, y) {
    return y < x ? -1 : 1;
};

var ascending = function (typeOfData) {
    if (typeOfData === 'number') {
        return stabilize(ascendingNumbers, false);
    }
    return stabilize(ascendingAllOthers, false);
};

var descending = function (typeOfData) {
    if (typeOfData === 'number') {
        return stabilize(descendingNumbers, true);
    }
    return stabilize(descendingAllOthers, true);
};

module.exports = (function () {

    function sort(indexVector, dataSource, sortType) {

        var compare, i;

        if (indexVector.length === 0) {
            return; //nothing to do;
        }

        if (sortType === undefined) {
            sortType = 1;
        }

        if (sortType === 0) {
            return; // nothing to sort here;
        }

        var typeOfData = typeof dataSource(0);

        compare = (sortType === 1) ? ascending(typeOfData) : descending(typeOfData);

        //start the actually sorting.....
        var tmp = new Array(indexVector.length);

        //lets add the index for stability
        for (i = 0; i < indexVector.length; i++) {
            tmp[i] = [dataSource(i), i];
        }

        tmp.sort(compare);

        //copy the sorted values into our index vector
        for (i = 0; i < indexVector.length; i++) {
            indexVector[i] = tmp[i][1];
        }
    }

    return sort;
})();
}).call(this,require("oMfpAn"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/stableSort.js","/")
},{"buffer":1,"oMfpAn":4}]},{},[21])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi9Vc2Vycy9zdGV2ZXdpcnRzL1Byb2plY3RzL2ZpbmFuYWx5dGljcy9ub2RlX21vZHVsZXMvZ3VscC1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCIvVXNlcnMvc3RldmV3aXJ0cy9Qcm9qZWN0cy9maW5hbmFseXRpY3Mvbm9kZV9tb2R1bGVzL2d1bHAtYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL2luZGV4LmpzIiwiL1VzZXJzL3N0ZXZld2lydHMvUHJvamVjdHMvZmluYW5hbHl0aWNzL25vZGVfbW9kdWxlcy9ndWxwLWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvYmFzZTY0LWpzL2xpYi9iNjQuanMiLCIvVXNlcnMvc3RldmV3aXJ0cy9Qcm9qZWN0cy9maW5hbmFseXRpY3Mvbm9kZV9tb2R1bGVzL2d1bHAtYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9pZWVlNzU0L2luZGV4LmpzIiwiL1VzZXJzL3N0ZXZld2lydHMvUHJvamVjdHMvZmluYW5hbHl0aWNzL25vZGVfbW9kdWxlcy9ndWxwLWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL3Byb2Nlc3MvYnJvd3Nlci5qcyIsIi9Vc2Vycy9zdGV2ZXdpcnRzL1Byb2plY3RzL2ZpbmFuYWx5dGljcy9ub2RlX21vZHVsZXMvb2JqZWN0Lm9ic2VydmUvZGlzdC9vYmplY3Qtb2JzZXJ2ZS5qcyIsIi9Vc2Vycy9zdGV2ZXdpcnRzL1Byb2plY3RzL2ZpbmFuYWx5dGljcy9zcmMvanMvRGF0YU5vZGVCYXNlLmpzIiwiL1VzZXJzL3N0ZXZld2lydHMvUHJvamVjdHMvZmluYW5hbHl0aWNzL3NyYy9qcy9EYXRhTm9kZUdyb3VwLmpzIiwiL1VzZXJzL3N0ZXZld2lydHMvUHJvamVjdHMvZmluYW5hbHl0aWNzL3NyYy9qcy9EYXRhTm9kZUxlYWYuanMiLCIvVXNlcnMvc3RldmV3aXJ0cy9Qcm9qZWN0cy9maW5hbmFseXRpY3Mvc3JjL2pzL0RhdGFOb2RlVHJlZS5qcyIsIi9Vc2Vycy9zdGV2ZXdpcnRzL1Byb2plY3RzL2ZpbmFuYWx5dGljcy9zcmMvanMvRGF0YVNvdXJjZUFnZ3JlZ2F0b3IuanMiLCIvVXNlcnMvc3RldmV3aXJ0cy9Qcm9qZWN0cy9maW5hbmFseXRpY3Mvc3JjL2pzL0RhdGFTb3VyY2VEZWNvcmF0b3IuanMiLCIvVXNlcnMvc3RldmV3aXJ0cy9Qcm9qZWN0cy9maW5hbmFseXRpY3Mvc3JjL2pzL0RhdGFTb3VyY2VGaWx0ZXIuanMiLCIvVXNlcnMvc3RldmV3aXJ0cy9Qcm9qZWN0cy9maW5hbmFseXRpY3Mvc3JjL2pzL0RhdGFTb3VyY2VHbG9iYWxGaWx0ZXIuanMiLCIvVXNlcnMvc3RldmV3aXJ0cy9Qcm9qZWN0cy9maW5hbmFseXRpY3Mvc3JjL2pzL0RhdGFTb3VyY2VTb3J0ZXIuanMiLCIvVXNlcnMvc3RldmV3aXJ0cy9Qcm9qZWN0cy9maW5hbmFseXRpY3Mvc3JjL2pzL0RhdGFTb3VyY2VTb3J0ZXJDb21wb3NpdGUuanMiLCIvVXNlcnMvc3RldmV3aXJ0cy9Qcm9qZWN0cy9maW5hbmFseXRpY3Mvc3JjL2pzL0pTRGF0YVNvdXJjZS5qcyIsIi9Vc2Vycy9zdGV2ZXdpcnRzL1Byb2plY3RzL2ZpbmFuYWx5dGljcy9zcmMvanMvTWFwLmpzIiwiL1VzZXJzL3N0ZXZld2lydHMvUHJvamVjdHMvZmluYW5hbHl0aWNzL3NyYy9qcy9VdGlscy5qcyIsIi9Vc2Vycy9zdGV2ZXdpcnRzL1Byb2plY3RzL2ZpbmFuYWx5dGljcy9zcmMvanMvYWdncmVnYXRpb25zLmpzIiwiL1VzZXJzL3N0ZXZld2lydHMvUHJvamVjdHMvZmluYW5hbHl0aWNzL3NyYy9qcy9hbmFseXRpY3MuanMiLCIvVXNlcnMvc3RldmV3aXJ0cy9Qcm9qZWN0cy9maW5hbmFseXRpY3Mvc3JjL2pzL2Zha2VfMWEzMmE2OGEuanMiLCIvVXNlcnMvc3RldmV3aXJ0cy9Qcm9qZWN0cy9maW5hbmFseXRpY3Mvc3JjL2pzL3N0YWJsZVNvcnQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZsQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOUhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcHVCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5RUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9DQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6SUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpfXZhciBmPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChmLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGYsZi5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG4vKiFcbiAqIFRoZSBidWZmZXIgbW9kdWxlIGZyb20gbm9kZS5qcywgZm9yIHRoZSBicm93c2VyLlxuICpcbiAqIEBhdXRob3IgICBGZXJvc3MgQWJvdWtoYWRpamVoIDxmZXJvc3NAZmVyb3NzLm9yZz4gPGh0dHA6Ly9mZXJvc3Mub3JnPlxuICogQGxpY2Vuc2UgIE1JVFxuICovXG5cbnZhciBiYXNlNjQgPSByZXF1aXJlKCdiYXNlNjQtanMnKVxudmFyIGllZWU3NTQgPSByZXF1aXJlKCdpZWVlNzU0JylcblxuZXhwb3J0cy5CdWZmZXIgPSBCdWZmZXJcbmV4cG9ydHMuU2xvd0J1ZmZlciA9IEJ1ZmZlclxuZXhwb3J0cy5JTlNQRUNUX01BWF9CWVRFUyA9IDUwXG5CdWZmZXIucG9vbFNpemUgPSA4MTkyXG5cbi8qKlxuICogSWYgYEJ1ZmZlci5fdXNlVHlwZWRBcnJheXNgOlxuICogICA9PT0gdHJ1ZSAgICBVc2UgVWludDhBcnJheSBpbXBsZW1lbnRhdGlvbiAoZmFzdGVzdClcbiAqICAgPT09IGZhbHNlICAgVXNlIE9iamVjdCBpbXBsZW1lbnRhdGlvbiAoY29tcGF0aWJsZSBkb3duIHRvIElFNilcbiAqL1xuQnVmZmVyLl91c2VUeXBlZEFycmF5cyA9IChmdW5jdGlvbiAoKSB7XG4gIC8vIERldGVjdCBpZiBicm93c2VyIHN1cHBvcnRzIFR5cGVkIEFycmF5cy4gU3VwcG9ydGVkIGJyb3dzZXJzIGFyZSBJRSAxMCssIEZpcmVmb3ggNCssXG4gIC8vIENocm9tZSA3KywgU2FmYXJpIDUuMSssIE9wZXJhIDExLjYrLCBpT1MgNC4yKy4gSWYgdGhlIGJyb3dzZXIgZG9lcyBub3Qgc3VwcG9ydCBhZGRpbmdcbiAgLy8gcHJvcGVydGllcyB0byBgVWludDhBcnJheWAgaW5zdGFuY2VzLCB0aGVuIHRoYXQncyB0aGUgc2FtZSBhcyBubyBgVWludDhBcnJheWAgc3VwcG9ydFxuICAvLyBiZWNhdXNlIHdlIG5lZWQgdG8gYmUgYWJsZSB0byBhZGQgYWxsIHRoZSBub2RlIEJ1ZmZlciBBUEkgbWV0aG9kcy4gVGhpcyBpcyBhbiBpc3N1ZVxuICAvLyBpbiBGaXJlZm94IDQtMjkuIE5vdyBmaXhlZDogaHR0cHM6Ly9idWd6aWxsYS5tb3ppbGxhLm9yZy9zaG93X2J1Zy5jZ2k/aWQ9Njk1NDM4XG4gIHRyeSB7XG4gICAgdmFyIGJ1ZiA9IG5ldyBBcnJheUJ1ZmZlcigwKVxuICAgIHZhciBhcnIgPSBuZXcgVWludDhBcnJheShidWYpXG4gICAgYXJyLmZvbyA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuIDQyIH1cbiAgICByZXR1cm4gNDIgPT09IGFyci5mb28oKSAmJlxuICAgICAgICB0eXBlb2YgYXJyLnN1YmFycmF5ID09PSAnZnVuY3Rpb24nIC8vIENocm9tZSA5LTEwIGxhY2sgYHN1YmFycmF5YFxuICB9IGNhdGNoIChlKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbn0pKClcblxuLyoqXG4gKiBDbGFzczogQnVmZmVyXG4gKiA9PT09PT09PT09PT09XG4gKlxuICogVGhlIEJ1ZmZlciBjb25zdHJ1Y3RvciByZXR1cm5zIGluc3RhbmNlcyBvZiBgVWludDhBcnJheWAgdGhhdCBhcmUgYXVnbWVudGVkXG4gKiB3aXRoIGZ1bmN0aW9uIHByb3BlcnRpZXMgZm9yIGFsbCB0aGUgbm9kZSBgQnVmZmVyYCBBUEkgZnVuY3Rpb25zLiBXZSB1c2VcbiAqIGBVaW50OEFycmF5YCBzbyB0aGF0IHNxdWFyZSBicmFja2V0IG5vdGF0aW9uIHdvcmtzIGFzIGV4cGVjdGVkIC0tIGl0IHJldHVybnNcbiAqIGEgc2luZ2xlIG9jdGV0LlxuICpcbiAqIEJ5IGF1Z21lbnRpbmcgdGhlIGluc3RhbmNlcywgd2UgY2FuIGF2b2lkIG1vZGlmeWluZyB0aGUgYFVpbnQ4QXJyYXlgXG4gKiBwcm90b3R5cGUuXG4gKi9cbmZ1bmN0aW9uIEJ1ZmZlciAoc3ViamVjdCwgZW5jb2RpbmcsIG5vWmVybykge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgQnVmZmVyKSlcbiAgICByZXR1cm4gbmV3IEJ1ZmZlcihzdWJqZWN0LCBlbmNvZGluZywgbm9aZXJvKVxuXG4gIHZhciB0eXBlID0gdHlwZW9mIHN1YmplY3RcblxuICAvLyBXb3JrYXJvdW5kOiBub2RlJ3MgYmFzZTY0IGltcGxlbWVudGF0aW9uIGFsbG93cyBmb3Igbm9uLXBhZGRlZCBzdHJpbmdzXG4gIC8vIHdoaWxlIGJhc2U2NC1qcyBkb2VzIG5vdC5cbiAgaWYgKGVuY29kaW5nID09PSAnYmFzZTY0JyAmJiB0eXBlID09PSAnc3RyaW5nJykge1xuICAgIHN1YmplY3QgPSBzdHJpbmd0cmltKHN1YmplY3QpXG4gICAgd2hpbGUgKHN1YmplY3QubGVuZ3RoICUgNCAhPT0gMCkge1xuICAgICAgc3ViamVjdCA9IHN1YmplY3QgKyAnPSdcbiAgICB9XG4gIH1cblxuICAvLyBGaW5kIHRoZSBsZW5ndGhcbiAgdmFyIGxlbmd0aFxuICBpZiAodHlwZSA9PT0gJ251bWJlcicpXG4gICAgbGVuZ3RoID0gY29lcmNlKHN1YmplY3QpXG4gIGVsc2UgaWYgKHR5cGUgPT09ICdzdHJpbmcnKVxuICAgIGxlbmd0aCA9IEJ1ZmZlci5ieXRlTGVuZ3RoKHN1YmplY3QsIGVuY29kaW5nKVxuICBlbHNlIGlmICh0eXBlID09PSAnb2JqZWN0JylcbiAgICBsZW5ndGggPSBjb2VyY2Uoc3ViamVjdC5sZW5ndGgpIC8vIGFzc3VtZSB0aGF0IG9iamVjdCBpcyBhcnJheS1saWtlXG4gIGVsc2VcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZpcnN0IGFyZ3VtZW50IG5lZWRzIHRvIGJlIGEgbnVtYmVyLCBhcnJheSBvciBzdHJpbmcuJylcblxuICB2YXIgYnVmXG4gIGlmIChCdWZmZXIuX3VzZVR5cGVkQXJyYXlzKSB7XG4gICAgLy8gUHJlZmVycmVkOiBSZXR1cm4gYW4gYXVnbWVudGVkIGBVaW50OEFycmF5YCBpbnN0YW5jZSBmb3IgYmVzdCBwZXJmb3JtYW5jZVxuICAgIGJ1ZiA9IEJ1ZmZlci5fYXVnbWVudChuZXcgVWludDhBcnJheShsZW5ndGgpKVxuICB9IGVsc2Uge1xuICAgIC8vIEZhbGxiYWNrOiBSZXR1cm4gVEhJUyBpbnN0YW5jZSBvZiBCdWZmZXIgKGNyZWF0ZWQgYnkgYG5ld2ApXG4gICAgYnVmID0gdGhpc1xuICAgIGJ1Zi5sZW5ndGggPSBsZW5ndGhcbiAgICBidWYuX2lzQnVmZmVyID0gdHJ1ZVxuICB9XG5cbiAgdmFyIGlcbiAgaWYgKEJ1ZmZlci5fdXNlVHlwZWRBcnJheXMgJiYgdHlwZW9mIHN1YmplY3QuYnl0ZUxlbmd0aCA9PT0gJ251bWJlcicpIHtcbiAgICAvLyBTcGVlZCBvcHRpbWl6YXRpb24gLS0gdXNlIHNldCBpZiB3ZSdyZSBjb3B5aW5nIGZyb20gYSB0eXBlZCBhcnJheVxuICAgIGJ1Zi5fc2V0KHN1YmplY3QpXG4gIH0gZWxzZSBpZiAoaXNBcnJheWlzaChzdWJqZWN0KSkge1xuICAgIC8vIFRyZWF0IGFycmF5LWlzaCBvYmplY3RzIGFzIGEgYnl0ZSBhcnJheVxuICAgIGZvciAoaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgaWYgKEJ1ZmZlci5pc0J1ZmZlcihzdWJqZWN0KSlcbiAgICAgICAgYnVmW2ldID0gc3ViamVjdC5yZWFkVUludDgoaSlcbiAgICAgIGVsc2VcbiAgICAgICAgYnVmW2ldID0gc3ViamVjdFtpXVxuICAgIH1cbiAgfSBlbHNlIGlmICh0eXBlID09PSAnc3RyaW5nJykge1xuICAgIGJ1Zi53cml0ZShzdWJqZWN0LCAwLCBlbmNvZGluZylcbiAgfSBlbHNlIGlmICh0eXBlID09PSAnbnVtYmVyJyAmJiAhQnVmZmVyLl91c2VUeXBlZEFycmF5cyAmJiAhbm9aZXJvKSB7XG4gICAgZm9yIChpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICBidWZbaV0gPSAwXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGJ1ZlxufVxuXG4vLyBTVEFUSUMgTUVUSE9EU1xuLy8gPT09PT09PT09PT09PT1cblxuQnVmZmVyLmlzRW5jb2RpbmcgPSBmdW5jdGlvbiAoZW5jb2RpbmcpIHtcbiAgc3dpdGNoIChTdHJpbmcoZW5jb2RpbmcpLnRvTG93ZXJDYXNlKCkpIHtcbiAgICBjYXNlICdoZXgnOlxuICAgIGNhc2UgJ3V0ZjgnOlxuICAgIGNhc2UgJ3V0Zi04JzpcbiAgICBjYXNlICdhc2NpaSc6XG4gICAgY2FzZSAnYmluYXJ5JzpcbiAgICBjYXNlICdiYXNlNjQnOlxuICAgIGNhc2UgJ3Jhdyc6XG4gICAgY2FzZSAndWNzMic6XG4gICAgY2FzZSAndWNzLTInOlxuICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgIHJldHVybiB0cnVlXG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBmYWxzZVxuICB9XG59XG5cbkJ1ZmZlci5pc0J1ZmZlciA9IGZ1bmN0aW9uIChiKSB7XG4gIHJldHVybiAhIShiICE9PSBudWxsICYmIGIgIT09IHVuZGVmaW5lZCAmJiBiLl9pc0J1ZmZlcilcbn1cblxuQnVmZmVyLmJ5dGVMZW5ndGggPSBmdW5jdGlvbiAoc3RyLCBlbmNvZGluZykge1xuICB2YXIgcmV0XG4gIHN0ciA9IHN0ciArICcnXG4gIHN3aXRjaCAoZW5jb2RpbmcgfHwgJ3V0ZjgnKSB7XG4gICAgY2FzZSAnaGV4JzpcbiAgICAgIHJldCA9IHN0ci5sZW5ndGggLyAyXG4gICAgICBicmVha1xuICAgIGNhc2UgJ3V0ZjgnOlxuICAgIGNhc2UgJ3V0Zi04JzpcbiAgICAgIHJldCA9IHV0ZjhUb0J5dGVzKHN0cikubGVuZ3RoXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2FzY2lpJzpcbiAgICBjYXNlICdiaW5hcnknOlxuICAgIGNhc2UgJ3Jhdyc6XG4gICAgICByZXQgPSBzdHIubGVuZ3RoXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICByZXQgPSBiYXNlNjRUb0J5dGVzKHN0cikubGVuZ3RoXG4gICAgICBicmVha1xuICAgIGNhc2UgJ3VjczInOlxuICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICBjYXNlICd1dGYxNmxlJzpcbiAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICByZXQgPSBzdHIubGVuZ3RoICogMlxuICAgICAgYnJlYWtcbiAgICBkZWZhdWx0OlxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVbmtub3duIGVuY29kaW5nJylcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbkJ1ZmZlci5jb25jYXQgPSBmdW5jdGlvbiAobGlzdCwgdG90YWxMZW5ndGgpIHtcbiAgYXNzZXJ0KGlzQXJyYXkobGlzdCksICdVc2FnZTogQnVmZmVyLmNvbmNhdChsaXN0LCBbdG90YWxMZW5ndGhdKVxcbicgK1xuICAgICAgJ2xpc3Qgc2hvdWxkIGJlIGFuIEFycmF5LicpXG5cbiAgaWYgKGxpc3QubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIG5ldyBCdWZmZXIoMClcbiAgfSBlbHNlIGlmIChsaXN0Lmxlbmd0aCA9PT0gMSkge1xuICAgIHJldHVybiBsaXN0WzBdXG4gIH1cblxuICB2YXIgaVxuICBpZiAodHlwZW9mIHRvdGFsTGVuZ3RoICE9PSAnbnVtYmVyJykge1xuICAgIHRvdGFsTGVuZ3RoID0gMFxuICAgIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICB0b3RhbExlbmd0aCArPSBsaXN0W2ldLmxlbmd0aFxuICAgIH1cbiAgfVxuXG4gIHZhciBidWYgPSBuZXcgQnVmZmVyKHRvdGFsTGVuZ3RoKVxuICB2YXIgcG9zID0gMFxuICBmb3IgKGkgPSAwOyBpIDwgbGlzdC5sZW5ndGg7IGkrKykge1xuICAgIHZhciBpdGVtID0gbGlzdFtpXVxuICAgIGl0ZW0uY29weShidWYsIHBvcylcbiAgICBwb3MgKz0gaXRlbS5sZW5ndGhcbiAgfVxuICByZXR1cm4gYnVmXG59XG5cbi8vIEJVRkZFUiBJTlNUQU5DRSBNRVRIT0RTXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PVxuXG5mdW5jdGlvbiBfaGV4V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICBvZmZzZXQgPSBOdW1iZXIob2Zmc2V0KSB8fCAwXG4gIHZhciByZW1haW5pbmcgPSBidWYubGVuZ3RoIC0gb2Zmc2V0XG4gIGlmICghbGVuZ3RoKSB7XG4gICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gIH0gZWxzZSB7XG4gICAgbGVuZ3RoID0gTnVtYmVyKGxlbmd0aClcbiAgICBpZiAobGVuZ3RoID4gcmVtYWluaW5nKSB7XG4gICAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgICB9XG4gIH1cblxuICAvLyBtdXN0IGJlIGFuIGV2ZW4gbnVtYmVyIG9mIGRpZ2l0c1xuICB2YXIgc3RyTGVuID0gc3RyaW5nLmxlbmd0aFxuICBhc3NlcnQoc3RyTGVuICUgMiA9PT0gMCwgJ0ludmFsaWQgaGV4IHN0cmluZycpXG5cbiAgaWYgKGxlbmd0aCA+IHN0ckxlbiAvIDIpIHtcbiAgICBsZW5ndGggPSBzdHJMZW4gLyAyXG4gIH1cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIHZhciBieXRlID0gcGFyc2VJbnQoc3RyaW5nLnN1YnN0cihpICogMiwgMiksIDE2KVxuICAgIGFzc2VydCghaXNOYU4oYnl0ZSksICdJbnZhbGlkIGhleCBzdHJpbmcnKVxuICAgIGJ1ZltvZmZzZXQgKyBpXSA9IGJ5dGVcbiAgfVxuICBCdWZmZXIuX2NoYXJzV3JpdHRlbiA9IGkgKiAyXG4gIHJldHVybiBpXG59XG5cbmZ1bmN0aW9uIF91dGY4V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICB2YXIgY2hhcnNXcml0dGVuID0gQnVmZmVyLl9jaGFyc1dyaXR0ZW4gPVxuICAgIGJsaXRCdWZmZXIodXRmOFRvQnl0ZXMoc3RyaW5nKSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbiAgcmV0dXJuIGNoYXJzV3JpdHRlblxufVxuXG5mdW5jdGlvbiBfYXNjaWlXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHZhciBjaGFyc1dyaXR0ZW4gPSBCdWZmZXIuX2NoYXJzV3JpdHRlbiA9XG4gICAgYmxpdEJ1ZmZlcihhc2NpaVRvQnl0ZXMoc3RyaW5nKSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbiAgcmV0dXJuIGNoYXJzV3JpdHRlblxufVxuXG5mdW5jdGlvbiBfYmluYXJ5V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gX2FzY2lpV3JpdGUoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5mdW5jdGlvbiBfYmFzZTY0V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICB2YXIgY2hhcnNXcml0dGVuID0gQnVmZmVyLl9jaGFyc1dyaXR0ZW4gPVxuICAgIGJsaXRCdWZmZXIoYmFzZTY0VG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxuICByZXR1cm4gY2hhcnNXcml0dGVuXG59XG5cbmZ1bmN0aW9uIF91dGYxNmxlV3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICB2YXIgY2hhcnNXcml0dGVuID0gQnVmZmVyLl9jaGFyc1dyaXR0ZW4gPVxuICAgIGJsaXRCdWZmZXIodXRmMTZsZVRvQnl0ZXMoc3RyaW5nKSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbiAgcmV0dXJuIGNoYXJzV3JpdHRlblxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlID0gZnVuY3Rpb24gKHN0cmluZywgb2Zmc2V0LCBsZW5ndGgsIGVuY29kaW5nKSB7XG4gIC8vIFN1cHBvcnQgYm90aCAoc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCwgZW5jb2RpbmcpXG4gIC8vIGFuZCB0aGUgbGVnYWN5IChzdHJpbmcsIGVuY29kaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgaWYgKGlzRmluaXRlKG9mZnNldCkpIHtcbiAgICBpZiAoIWlzRmluaXRlKGxlbmd0aCkpIHtcbiAgICAgIGVuY29kaW5nID0gbGVuZ3RoXG4gICAgICBsZW5ndGggPSB1bmRlZmluZWRcbiAgICB9XG4gIH0gZWxzZSB7ICAvLyBsZWdhY3lcbiAgICB2YXIgc3dhcCA9IGVuY29kaW5nXG4gICAgZW5jb2RpbmcgPSBvZmZzZXRcbiAgICBvZmZzZXQgPSBsZW5ndGhcbiAgICBsZW5ndGggPSBzd2FwXG4gIH1cblxuICBvZmZzZXQgPSBOdW1iZXIob2Zmc2V0KSB8fCAwXG4gIHZhciByZW1haW5pbmcgPSB0aGlzLmxlbmd0aCAtIG9mZnNldFxuICBpZiAoIWxlbmd0aCkge1xuICAgIGxlbmd0aCA9IHJlbWFpbmluZ1xuICB9IGVsc2Uge1xuICAgIGxlbmd0aCA9IE51bWJlcihsZW5ndGgpXG4gICAgaWYgKGxlbmd0aCA+IHJlbWFpbmluZykge1xuICAgICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gICAgfVxuICB9XG4gIGVuY29kaW5nID0gU3RyaW5nKGVuY29kaW5nIHx8ICd1dGY4JykudG9Mb3dlckNhc2UoKVxuXG4gIHZhciByZXRcbiAgc3dpdGNoIChlbmNvZGluZykge1xuICAgIGNhc2UgJ2hleCc6XG4gICAgICByZXQgPSBfaGV4V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgICAgcmV0ID0gX3V0ZjhXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICdhc2NpaSc6XG4gICAgICByZXQgPSBfYXNjaWlXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICdiaW5hcnknOlxuICAgICAgcmV0ID0gX2JpbmFyeVdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICByZXQgPSBfYmFzZTY0V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAndWNzMic6XG4gICAgY2FzZSAndWNzLTInOlxuICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgIHJldCA9IF91dGYxNmxlV3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgICAgIGJyZWFrXG4gICAgZGVmYXVsdDpcbiAgICAgIHRocm93IG5ldyBFcnJvcignVW5rbm93biBlbmNvZGluZycpXG4gIH1cbiAgcmV0dXJuIHJldFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24gKGVuY29kaW5nLCBzdGFydCwgZW5kKSB7XG4gIHZhciBzZWxmID0gdGhpc1xuXG4gIGVuY29kaW5nID0gU3RyaW5nKGVuY29kaW5nIHx8ICd1dGY4JykudG9Mb3dlckNhc2UoKVxuICBzdGFydCA9IE51bWJlcihzdGFydCkgfHwgMFxuICBlbmQgPSAoZW5kICE9PSB1bmRlZmluZWQpXG4gICAgPyBOdW1iZXIoZW5kKVxuICAgIDogZW5kID0gc2VsZi5sZW5ndGhcblxuICAvLyBGYXN0cGF0aCBlbXB0eSBzdHJpbmdzXG4gIGlmIChlbmQgPT09IHN0YXJ0KVxuICAgIHJldHVybiAnJ1xuXG4gIHZhciByZXRcbiAgc3dpdGNoIChlbmNvZGluZykge1xuICAgIGNhc2UgJ2hleCc6XG4gICAgICByZXQgPSBfaGV4U2xpY2Uoc2VsZiwgc3RhcnQsIGVuZClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgICAgcmV0ID0gX3V0ZjhTbGljZShzZWxmLCBzdGFydCwgZW5kKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICdhc2NpaSc6XG4gICAgICByZXQgPSBfYXNjaWlTbGljZShzZWxmLCBzdGFydCwgZW5kKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICdiaW5hcnknOlxuICAgICAgcmV0ID0gX2JpbmFyeVNsaWNlKHNlbGYsIHN0YXJ0LCBlbmQpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICByZXQgPSBfYmFzZTY0U2xpY2Uoc2VsZiwgc3RhcnQsIGVuZClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAndWNzMic6XG4gICAgY2FzZSAndWNzLTInOlxuICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgIHJldCA9IF91dGYxNmxlU2xpY2Uoc2VsZiwgc3RhcnQsIGVuZClcbiAgICAgIGJyZWFrXG4gICAgZGVmYXVsdDpcbiAgICAgIHRocm93IG5ldyBFcnJvcignVW5rbm93biBlbmNvZGluZycpXG4gIH1cbiAgcmV0dXJuIHJldFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnRvSlNPTiA9IGZ1bmN0aW9uICgpIHtcbiAgcmV0dXJuIHtcbiAgICB0eXBlOiAnQnVmZmVyJyxcbiAgICBkYXRhOiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbCh0aGlzLl9hcnIgfHwgdGhpcywgMClcbiAgfVxufVxuXG4vLyBjb3B5KHRhcmdldEJ1ZmZlciwgdGFyZ2V0U3RhcnQ9MCwgc291cmNlU3RhcnQ9MCwgc291cmNlRW5kPWJ1ZmZlci5sZW5ndGgpXG5CdWZmZXIucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbiAodGFyZ2V0LCB0YXJnZXRfc3RhcnQsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHNvdXJjZSA9IHRoaXNcblxuICBpZiAoIXN0YXJ0KSBzdGFydCA9IDBcbiAgaWYgKCFlbmQgJiYgZW5kICE9PSAwKSBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAoIXRhcmdldF9zdGFydCkgdGFyZ2V0X3N0YXJ0ID0gMFxuXG4gIC8vIENvcHkgMCBieXRlczsgd2UncmUgZG9uZVxuICBpZiAoZW5kID09PSBzdGFydCkgcmV0dXJuXG4gIGlmICh0YXJnZXQubGVuZ3RoID09PSAwIHx8IHNvdXJjZS5sZW5ndGggPT09IDApIHJldHVyblxuXG4gIC8vIEZhdGFsIGVycm9yIGNvbmRpdGlvbnNcbiAgYXNzZXJ0KGVuZCA+PSBzdGFydCwgJ3NvdXJjZUVuZCA8IHNvdXJjZVN0YXJ0JylcbiAgYXNzZXJ0KHRhcmdldF9zdGFydCA+PSAwICYmIHRhcmdldF9zdGFydCA8IHRhcmdldC5sZW5ndGgsXG4gICAgICAndGFyZ2V0U3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGFzc2VydChzdGFydCA+PSAwICYmIHN0YXJ0IDwgc291cmNlLmxlbmd0aCwgJ3NvdXJjZVN0YXJ0IG91dCBvZiBib3VuZHMnKVxuICBhc3NlcnQoZW5kID49IDAgJiYgZW5kIDw9IHNvdXJjZS5sZW5ndGgsICdzb3VyY2VFbmQgb3V0IG9mIGJvdW5kcycpXG5cbiAgLy8gQXJlIHdlIG9vYj9cbiAgaWYgKGVuZCA+IHRoaXMubGVuZ3RoKVxuICAgIGVuZCA9IHRoaXMubGVuZ3RoXG4gIGlmICh0YXJnZXQubGVuZ3RoIC0gdGFyZ2V0X3N0YXJ0IDwgZW5kIC0gc3RhcnQpXG4gICAgZW5kID0gdGFyZ2V0Lmxlbmd0aCAtIHRhcmdldF9zdGFydCArIHN0YXJ0XG5cbiAgdmFyIGxlbiA9IGVuZCAtIHN0YXJ0XG5cbiAgaWYgKGxlbiA8IDEwMCB8fCAhQnVmZmVyLl91c2VUeXBlZEFycmF5cykge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyBpKyspXG4gICAgICB0YXJnZXRbaSArIHRhcmdldF9zdGFydF0gPSB0aGlzW2kgKyBzdGFydF1cbiAgfSBlbHNlIHtcbiAgICB0YXJnZXQuX3NldCh0aGlzLnN1YmFycmF5KHN0YXJ0LCBzdGFydCArIGxlbiksIHRhcmdldF9zdGFydClcbiAgfVxufVxuXG5mdW5jdGlvbiBfYmFzZTY0U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICBpZiAoc3RhcnQgPT09IDAgJiYgZW5kID09PSBidWYubGVuZ3RoKSB7XG4gICAgcmV0dXJuIGJhc2U2NC5mcm9tQnl0ZUFycmF5KGJ1ZilcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gYmFzZTY0LmZyb21CeXRlQXJyYXkoYnVmLnNsaWNlKHN0YXJ0LCBlbmQpKVxuICB9XG59XG5cbmZ1bmN0aW9uIF91dGY4U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgcmVzID0gJydcbiAgdmFyIHRtcCA9ICcnXG4gIGVuZCA9IE1hdGgubWluKGJ1Zi5sZW5ndGgsIGVuZClcblxuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIGlmIChidWZbaV0gPD0gMHg3Rikge1xuICAgICAgcmVzICs9IGRlY29kZVV0ZjhDaGFyKHRtcCkgKyBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ1ZltpXSlcbiAgICAgIHRtcCA9ICcnXG4gICAgfSBlbHNlIHtcbiAgICAgIHRtcCArPSAnJScgKyBidWZbaV0udG9TdHJpbmcoMTYpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHJlcyArIGRlY29kZVV0ZjhDaGFyKHRtcClcbn1cblxuZnVuY3Rpb24gX2FzY2lpU2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgcmV0ID0gJydcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKVxuICAgIHJldCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ1ZltpXSlcbiAgcmV0dXJuIHJldFxufVxuXG5mdW5jdGlvbiBfYmluYXJ5U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICByZXR1cm4gX2FzY2lpU2xpY2UoYnVmLCBzdGFydCwgZW5kKVxufVxuXG5mdW5jdGlvbiBfaGV4U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgbGVuID0gYnVmLmxlbmd0aFxuXG4gIGlmICghc3RhcnQgfHwgc3RhcnQgPCAwKSBzdGFydCA9IDBcbiAgaWYgKCFlbmQgfHwgZW5kIDwgMCB8fCBlbmQgPiBsZW4pIGVuZCA9IGxlblxuXG4gIHZhciBvdXQgPSAnJ1xuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIG91dCArPSB0b0hleChidWZbaV0pXG4gIH1cbiAgcmV0dXJuIG91dFxufVxuXG5mdW5jdGlvbiBfdXRmMTZsZVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGJ5dGVzID0gYnVmLnNsaWNlKHN0YXJ0LCBlbmQpXG4gIHZhciByZXMgPSAnJ1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGJ5dGVzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgcmVzICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnl0ZXNbaV0gKyBieXRlc1tpKzFdICogMjU2KVxuICB9XG4gIHJldHVybiByZXNcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5zbGljZSA9IGZ1bmN0aW9uIChzdGFydCwgZW5kKSB7XG4gIHZhciBsZW4gPSB0aGlzLmxlbmd0aFxuICBzdGFydCA9IGNsYW1wKHN0YXJ0LCBsZW4sIDApXG4gIGVuZCA9IGNsYW1wKGVuZCwgbGVuLCBsZW4pXG5cbiAgaWYgKEJ1ZmZlci5fdXNlVHlwZWRBcnJheXMpIHtcbiAgICByZXR1cm4gQnVmZmVyLl9hdWdtZW50KHRoaXMuc3ViYXJyYXkoc3RhcnQsIGVuZCkpXG4gIH0gZWxzZSB7XG4gICAgdmFyIHNsaWNlTGVuID0gZW5kIC0gc3RhcnRcbiAgICB2YXIgbmV3QnVmID0gbmV3IEJ1ZmZlcihzbGljZUxlbiwgdW5kZWZpbmVkLCB0cnVlKVxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc2xpY2VMZW47IGkrKykge1xuICAgICAgbmV3QnVmW2ldID0gdGhpc1tpICsgc3RhcnRdXG4gICAgfVxuICAgIHJldHVybiBuZXdCdWZcbiAgfVxufVxuXG4vLyBgZ2V0YCB3aWxsIGJlIHJlbW92ZWQgaW4gTm9kZSAwLjEzK1xuQnVmZmVyLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbiAob2Zmc2V0KSB7XG4gIGNvbnNvbGUubG9nKCcuZ2V0KCkgaXMgZGVwcmVjYXRlZC4gQWNjZXNzIHVzaW5nIGFycmF5IGluZGV4ZXMgaW5zdGVhZC4nKVxuICByZXR1cm4gdGhpcy5yZWFkVUludDgob2Zmc2V0KVxufVxuXG4vLyBgc2V0YCB3aWxsIGJlIHJlbW92ZWQgaW4gTm9kZSAwLjEzK1xuQnVmZmVyLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbiAodiwgb2Zmc2V0KSB7XG4gIGNvbnNvbGUubG9nKCcuc2V0KCkgaXMgZGVwcmVjYXRlZC4gQWNjZXNzIHVzaW5nIGFycmF5IGluZGV4ZXMgaW5zdGVhZC4nKVxuICByZXR1cm4gdGhpcy53cml0ZVVJbnQ4KHYsIG9mZnNldClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDggPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0KG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCwgJ21pc3Npbmcgb2Zmc2V0JylcbiAgICBhc3NlcnQob2Zmc2V0IDwgdGhpcy5sZW5ndGgsICdUcnlpbmcgdG8gcmVhZCBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG4gIH1cblxuICBpZiAob2Zmc2V0ID49IHRoaXMubGVuZ3RoKVxuICAgIHJldHVyblxuXG4gIHJldHVybiB0aGlzW29mZnNldF1cbn1cblxuZnVuY3Rpb24gX3JlYWRVSW50MTYgKGJ1Ziwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQodHlwZW9mIGxpdHRsZUVuZGlhbiA9PT0gJ2Jvb2xlYW4nLCAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpXG4gICAgYXNzZXJ0KG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCwgJ21pc3Npbmcgb2Zmc2V0JylcbiAgICBhc3NlcnQob2Zmc2V0ICsgMSA8IGJ1Zi5sZW5ndGgsICdUcnlpbmcgdG8gcmVhZCBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG4gIH1cblxuICB2YXIgbGVuID0gYnVmLmxlbmd0aFxuICBpZiAob2Zmc2V0ID49IGxlbilcbiAgICByZXR1cm5cblxuICB2YXIgdmFsXG4gIGlmIChsaXR0bGVFbmRpYW4pIHtcbiAgICB2YWwgPSBidWZbb2Zmc2V0XVxuICAgIGlmIChvZmZzZXQgKyAxIDwgbGVuKVxuICAgICAgdmFsIHw9IGJ1ZltvZmZzZXQgKyAxXSA8PCA4XG4gIH0gZWxzZSB7XG4gICAgdmFsID0gYnVmW29mZnNldF0gPDwgOFxuICAgIGlmIChvZmZzZXQgKyAxIDwgbGVuKVxuICAgICAgdmFsIHw9IGJ1ZltvZmZzZXQgKyAxXVxuICB9XG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDE2TEUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gX3JlYWRVSW50MTYodGhpcywgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDE2QkUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gX3JlYWRVSW50MTYodGhpcywgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbmZ1bmN0aW9uIF9yZWFkVUludDMyIChidWYsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0KHR5cGVvZiBsaXR0bGVFbmRpYW4gPT09ICdib29sZWFuJywgJ21pc3Npbmcgb3IgaW52YWxpZCBlbmRpYW4nKVxuICAgIGFzc2VydChvZmZzZXQgIT09IHVuZGVmaW5lZCAmJiBvZmZzZXQgIT09IG51bGwsICdtaXNzaW5nIG9mZnNldCcpXG4gICAgYXNzZXJ0KG9mZnNldCArIDMgPCBidWYubGVuZ3RoLCAnVHJ5aW5nIHRvIHJlYWQgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxuICB9XG5cbiAgdmFyIGxlbiA9IGJ1Zi5sZW5ndGhcbiAgaWYgKG9mZnNldCA+PSBsZW4pXG4gICAgcmV0dXJuXG5cbiAgdmFyIHZhbFxuICBpZiAobGl0dGxlRW5kaWFuKSB7XG4gICAgaWYgKG9mZnNldCArIDIgPCBsZW4pXG4gICAgICB2YWwgPSBidWZbb2Zmc2V0ICsgMl0gPDwgMTZcbiAgICBpZiAob2Zmc2V0ICsgMSA8IGxlbilcbiAgICAgIHZhbCB8PSBidWZbb2Zmc2V0ICsgMV0gPDwgOFxuICAgIHZhbCB8PSBidWZbb2Zmc2V0XVxuICAgIGlmIChvZmZzZXQgKyAzIDwgbGVuKVxuICAgICAgdmFsID0gdmFsICsgKGJ1ZltvZmZzZXQgKyAzXSA8PCAyNCA+Pj4gMClcbiAgfSBlbHNlIHtcbiAgICBpZiAob2Zmc2V0ICsgMSA8IGxlbilcbiAgICAgIHZhbCA9IGJ1ZltvZmZzZXQgKyAxXSA8PCAxNlxuICAgIGlmIChvZmZzZXQgKyAyIDwgbGVuKVxuICAgICAgdmFsIHw9IGJ1ZltvZmZzZXQgKyAyXSA8PCA4XG4gICAgaWYgKG9mZnNldCArIDMgPCBsZW4pXG4gICAgICB2YWwgfD0gYnVmW29mZnNldCArIDNdXG4gICAgdmFsID0gdmFsICsgKGJ1ZltvZmZzZXRdIDw8IDI0ID4+PiAwKVxuICB9XG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDMyTEUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gX3JlYWRVSW50MzIodGhpcywgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDMyQkUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gX3JlYWRVSW50MzIodGhpcywgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDggPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0KG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCxcbiAgICAgICAgJ21pc3Npbmcgb2Zmc2V0JylcbiAgICBhc3NlcnQob2Zmc2V0IDwgdGhpcy5sZW5ndGgsICdUcnlpbmcgdG8gcmVhZCBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG4gIH1cblxuICBpZiAob2Zmc2V0ID49IHRoaXMubGVuZ3RoKVxuICAgIHJldHVyblxuXG4gIHZhciBuZWcgPSB0aGlzW29mZnNldF0gJiAweDgwXG4gIGlmIChuZWcpXG4gICAgcmV0dXJuICgweGZmIC0gdGhpc1tvZmZzZXRdICsgMSkgKiAtMVxuICBlbHNlXG4gICAgcmV0dXJuIHRoaXNbb2Zmc2V0XVxufVxuXG5mdW5jdGlvbiBfcmVhZEludDE2IChidWYsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0KHR5cGVvZiBsaXR0bGVFbmRpYW4gPT09ICdib29sZWFuJywgJ21pc3Npbmcgb3IgaW52YWxpZCBlbmRpYW4nKVxuICAgIGFzc2VydChvZmZzZXQgIT09IHVuZGVmaW5lZCAmJiBvZmZzZXQgIT09IG51bGwsICdtaXNzaW5nIG9mZnNldCcpXG4gICAgYXNzZXJ0KG9mZnNldCArIDEgPCBidWYubGVuZ3RoLCAnVHJ5aW5nIHRvIHJlYWQgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxuICB9XG5cbiAgdmFyIGxlbiA9IGJ1Zi5sZW5ndGhcbiAgaWYgKG9mZnNldCA+PSBsZW4pXG4gICAgcmV0dXJuXG5cbiAgdmFyIHZhbCA9IF9yZWFkVUludDE2KGJ1Ziwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIHRydWUpXG4gIHZhciBuZWcgPSB2YWwgJiAweDgwMDBcbiAgaWYgKG5lZylcbiAgICByZXR1cm4gKDB4ZmZmZiAtIHZhbCArIDEpICogLTFcbiAgZWxzZVxuICAgIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MTZMRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiBfcmVhZEludDE2KHRoaXMsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDE2QkUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gX3JlYWRJbnQxNih0aGlzLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuZnVuY3Rpb24gX3JlYWRJbnQzMiAoYnVmLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydCh0eXBlb2YgbGl0dGxlRW5kaWFuID09PSAnYm9vbGVhbicsICdtaXNzaW5nIG9yIGludmFsaWQgZW5kaWFuJylcbiAgICBhc3NlcnQob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLCAnbWlzc2luZyBvZmZzZXQnKVxuICAgIGFzc2VydChvZmZzZXQgKyAzIDwgYnVmLmxlbmd0aCwgJ1RyeWluZyB0byByZWFkIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbiAgfVxuXG4gIHZhciBsZW4gPSBidWYubGVuZ3RoXG4gIGlmIChvZmZzZXQgPj0gbGVuKVxuICAgIHJldHVyblxuXG4gIHZhciB2YWwgPSBfcmVhZFVJbnQzMihidWYsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCB0cnVlKVxuICB2YXIgbmVnID0gdmFsICYgMHg4MDAwMDAwMFxuICBpZiAobmVnKVxuICAgIHJldHVybiAoMHhmZmZmZmZmZiAtIHZhbCArIDEpICogLTFcbiAgZWxzZVxuICAgIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MzJMRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiBfcmVhZEludDMyKHRoaXMsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDMyQkUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gX3JlYWRJbnQzMih0aGlzLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuZnVuY3Rpb24gX3JlYWRGbG9hdCAoYnVmLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydCh0eXBlb2YgbGl0dGxlRW5kaWFuID09PSAnYm9vbGVhbicsICdtaXNzaW5nIG9yIGludmFsaWQgZW5kaWFuJylcbiAgICBhc3NlcnQob2Zmc2V0ICsgMyA8IGJ1Zi5sZW5ndGgsICdUcnlpbmcgdG8gcmVhZCBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG4gIH1cblxuICByZXR1cm4gaWVlZTc1NC5yZWFkKGJ1Ziwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIDIzLCA0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRGbG9hdExFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIF9yZWFkRmxvYXQodGhpcywgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRmxvYXRCRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiBfcmVhZEZsb2F0KHRoaXMsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG5mdW5jdGlvbiBfcmVhZERvdWJsZSAoYnVmLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydCh0eXBlb2YgbGl0dGxlRW5kaWFuID09PSAnYm9vbGVhbicsICdtaXNzaW5nIG9yIGludmFsaWQgZW5kaWFuJylcbiAgICBhc3NlcnQob2Zmc2V0ICsgNyA8IGJ1Zi5sZW5ndGgsICdUcnlpbmcgdG8gcmVhZCBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG4gIH1cblxuICByZXR1cm4gaWVlZTc1NC5yZWFkKGJ1Ziwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIDUyLCA4KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWREb3VibGVMRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiBfcmVhZERvdWJsZSh0aGlzLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWREb3VibGVCRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiBfcmVhZERvdWJsZSh0aGlzLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQ4ID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQodmFsdWUgIT09IHVuZGVmaW5lZCAmJiB2YWx1ZSAhPT0gbnVsbCwgJ21pc3NpbmcgdmFsdWUnKVxuICAgIGFzc2VydChvZmZzZXQgIT09IHVuZGVmaW5lZCAmJiBvZmZzZXQgIT09IG51bGwsICdtaXNzaW5nIG9mZnNldCcpXG4gICAgYXNzZXJ0KG9mZnNldCA8IHRoaXMubGVuZ3RoLCAndHJ5aW5nIHRvIHdyaXRlIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbiAgICB2ZXJpZnVpbnQodmFsdWUsIDB4ZmYpXG4gIH1cblxuICBpZiAob2Zmc2V0ID49IHRoaXMubGVuZ3RoKSByZXR1cm5cblxuICB0aGlzW29mZnNldF0gPSB2YWx1ZVxufVxuXG5mdW5jdGlvbiBfd3JpdGVVSW50MTYgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0KHZhbHVlICE9PSB1bmRlZmluZWQgJiYgdmFsdWUgIT09IG51bGwsICdtaXNzaW5nIHZhbHVlJylcbiAgICBhc3NlcnQodHlwZW9mIGxpdHRsZUVuZGlhbiA9PT0gJ2Jvb2xlYW4nLCAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpXG4gICAgYXNzZXJ0KG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCwgJ21pc3Npbmcgb2Zmc2V0JylcbiAgICBhc3NlcnQob2Zmc2V0ICsgMSA8IGJ1Zi5sZW5ndGgsICd0cnlpbmcgdG8gd3JpdGUgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxuICAgIHZlcmlmdWludCh2YWx1ZSwgMHhmZmZmKVxuICB9XG5cbiAgdmFyIGxlbiA9IGJ1Zi5sZW5ndGhcbiAgaWYgKG9mZnNldCA+PSBsZW4pXG4gICAgcmV0dXJuXG5cbiAgZm9yICh2YXIgaSA9IDAsIGogPSBNYXRoLm1pbihsZW4gLSBvZmZzZXQsIDIpOyBpIDwgajsgaSsrKSB7XG4gICAgYnVmW29mZnNldCArIGldID1cbiAgICAgICAgKHZhbHVlICYgKDB4ZmYgPDwgKDggKiAobGl0dGxlRW5kaWFuID8gaSA6IDEgLSBpKSkpKSA+Pj5cbiAgICAgICAgICAgIChsaXR0bGVFbmRpYW4gPyBpIDogMSAtIGkpICogOFxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MTZMRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICBfd3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MTZCRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICBfd3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG5mdW5jdGlvbiBfd3JpdGVVSW50MzIgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0KHZhbHVlICE9PSB1bmRlZmluZWQgJiYgdmFsdWUgIT09IG51bGwsICdtaXNzaW5nIHZhbHVlJylcbiAgICBhc3NlcnQodHlwZW9mIGxpdHRsZUVuZGlhbiA9PT0gJ2Jvb2xlYW4nLCAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpXG4gICAgYXNzZXJ0KG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCwgJ21pc3Npbmcgb2Zmc2V0JylcbiAgICBhc3NlcnQob2Zmc2V0ICsgMyA8IGJ1Zi5sZW5ndGgsICd0cnlpbmcgdG8gd3JpdGUgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxuICAgIHZlcmlmdWludCh2YWx1ZSwgMHhmZmZmZmZmZilcbiAgfVxuXG4gIHZhciBsZW4gPSBidWYubGVuZ3RoXG4gIGlmIChvZmZzZXQgPj0gbGVuKVxuICAgIHJldHVyblxuXG4gIGZvciAodmFyIGkgPSAwLCBqID0gTWF0aC5taW4obGVuIC0gb2Zmc2V0LCA0KTsgaSA8IGo7IGkrKykge1xuICAgIGJ1ZltvZmZzZXQgKyBpXSA9XG4gICAgICAgICh2YWx1ZSA+Pj4gKGxpdHRsZUVuZGlhbiA/IGkgOiAzIC0gaSkgKiA4KSAmIDB4ZmZcbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDMyTEUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgX3dyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDMyQkUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgX3dyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDggPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydCh2YWx1ZSAhPT0gdW5kZWZpbmVkICYmIHZhbHVlICE9PSBudWxsLCAnbWlzc2luZyB2YWx1ZScpXG4gICAgYXNzZXJ0KG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCwgJ21pc3Npbmcgb2Zmc2V0JylcbiAgICBhc3NlcnQob2Zmc2V0IDwgdGhpcy5sZW5ndGgsICdUcnlpbmcgdG8gd3JpdGUgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxuICAgIHZlcmlmc2ludCh2YWx1ZSwgMHg3ZiwgLTB4ODApXG4gIH1cblxuICBpZiAob2Zmc2V0ID49IHRoaXMubGVuZ3RoKVxuICAgIHJldHVyblxuXG4gIGlmICh2YWx1ZSA+PSAwKVxuICAgIHRoaXMud3JpdGVVSW50OCh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydClcbiAgZWxzZVxuICAgIHRoaXMud3JpdGVVSW50OCgweGZmICsgdmFsdWUgKyAxLCBvZmZzZXQsIG5vQXNzZXJ0KVxufVxuXG5mdW5jdGlvbiBfd3JpdGVJbnQxNiAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQodmFsdWUgIT09IHVuZGVmaW5lZCAmJiB2YWx1ZSAhPT0gbnVsbCwgJ21pc3NpbmcgdmFsdWUnKVxuICAgIGFzc2VydCh0eXBlb2YgbGl0dGxlRW5kaWFuID09PSAnYm9vbGVhbicsICdtaXNzaW5nIG9yIGludmFsaWQgZW5kaWFuJylcbiAgICBhc3NlcnQob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLCAnbWlzc2luZyBvZmZzZXQnKVxuICAgIGFzc2VydChvZmZzZXQgKyAxIDwgYnVmLmxlbmd0aCwgJ1RyeWluZyB0byB3cml0ZSBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG4gICAgdmVyaWZzaW50KHZhbHVlLCAweDdmZmYsIC0weDgwMDApXG4gIH1cblxuICB2YXIgbGVuID0gYnVmLmxlbmd0aFxuICBpZiAob2Zmc2V0ID49IGxlbilcbiAgICByZXR1cm5cblxuICBpZiAodmFsdWUgPj0gMClcbiAgICBfd3JpdGVVSW50MTYoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KVxuICBlbHNlXG4gICAgX3dyaXRlVUludDE2KGJ1ZiwgMHhmZmZmICsgdmFsdWUgKyAxLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQxNkxFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIF93cml0ZUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MTZCRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICBfd3JpdGVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbmZ1bmN0aW9uIF93cml0ZUludDMyIChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydCh2YWx1ZSAhPT0gdW5kZWZpbmVkICYmIHZhbHVlICE9PSBudWxsLCAnbWlzc2luZyB2YWx1ZScpXG4gICAgYXNzZXJ0KHR5cGVvZiBsaXR0bGVFbmRpYW4gPT09ICdib29sZWFuJywgJ21pc3Npbmcgb3IgaW52YWxpZCBlbmRpYW4nKVxuICAgIGFzc2VydChvZmZzZXQgIT09IHVuZGVmaW5lZCAmJiBvZmZzZXQgIT09IG51bGwsICdtaXNzaW5nIG9mZnNldCcpXG4gICAgYXNzZXJ0KG9mZnNldCArIDMgPCBidWYubGVuZ3RoLCAnVHJ5aW5nIHRvIHdyaXRlIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbiAgICB2ZXJpZnNpbnQodmFsdWUsIDB4N2ZmZmZmZmYsIC0weDgwMDAwMDAwKVxuICB9XG5cbiAgdmFyIGxlbiA9IGJ1Zi5sZW5ndGhcbiAgaWYgKG9mZnNldCA+PSBsZW4pXG4gICAgcmV0dXJuXG5cbiAgaWYgKHZhbHVlID49IDApXG4gICAgX3dyaXRlVUludDMyKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydClcbiAgZWxzZVxuICAgIF93cml0ZVVJbnQzMihidWYsIDB4ZmZmZmZmZmYgKyB2YWx1ZSArIDEsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyTEUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgX3dyaXRlSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQzMkJFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIF93cml0ZUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuZnVuY3Rpb24gX3dyaXRlRmxvYXQgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0KHZhbHVlICE9PSB1bmRlZmluZWQgJiYgdmFsdWUgIT09IG51bGwsICdtaXNzaW5nIHZhbHVlJylcbiAgICBhc3NlcnQodHlwZW9mIGxpdHRsZUVuZGlhbiA9PT0gJ2Jvb2xlYW4nLCAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpXG4gICAgYXNzZXJ0KG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCwgJ21pc3Npbmcgb2Zmc2V0JylcbiAgICBhc3NlcnQob2Zmc2V0ICsgMyA8IGJ1Zi5sZW5ndGgsICdUcnlpbmcgdG8gd3JpdGUgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxuICAgIHZlcmlmSUVFRTc1NCh2YWx1ZSwgMy40MDI4MjM0NjYzODUyODg2ZSszOCwgLTMuNDAyODIzNDY2Mzg1Mjg4NmUrMzgpXG4gIH1cblxuICB2YXIgbGVuID0gYnVmLmxlbmd0aFxuICBpZiAob2Zmc2V0ID49IGxlbilcbiAgICByZXR1cm5cblxuICBpZWVlNzU0LndyaXRlKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCAyMywgNClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUZsb2F0TEUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgX3dyaXRlRmxvYXQodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVGbG9hdEJFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIF93cml0ZUZsb2F0KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuZnVuY3Rpb24gX3dyaXRlRG91YmxlIChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydCh2YWx1ZSAhPT0gdW5kZWZpbmVkICYmIHZhbHVlICE9PSBudWxsLCAnbWlzc2luZyB2YWx1ZScpXG4gICAgYXNzZXJ0KHR5cGVvZiBsaXR0bGVFbmRpYW4gPT09ICdib29sZWFuJywgJ21pc3Npbmcgb3IgaW52YWxpZCBlbmRpYW4nKVxuICAgIGFzc2VydChvZmZzZXQgIT09IHVuZGVmaW5lZCAmJiBvZmZzZXQgIT09IG51bGwsICdtaXNzaW5nIG9mZnNldCcpXG4gICAgYXNzZXJ0KG9mZnNldCArIDcgPCBidWYubGVuZ3RoLFxuICAgICAgICAnVHJ5aW5nIHRvIHdyaXRlIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbiAgICB2ZXJpZklFRUU3NTQodmFsdWUsIDEuNzk3NjkzMTM0ODYyMzE1N0UrMzA4LCAtMS43OTc2OTMxMzQ4NjIzMTU3RSszMDgpXG4gIH1cblxuICB2YXIgbGVuID0gYnVmLmxlbmd0aFxuICBpZiAob2Zmc2V0ID49IGxlbilcbiAgICByZXR1cm5cblxuICBpZWVlNzU0LndyaXRlKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCA1MiwgOClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUxFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIF93cml0ZURvdWJsZSh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUJFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIF93cml0ZURvdWJsZSh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbi8vIGZpbGwodmFsdWUsIHN0YXJ0PTAsIGVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS5maWxsID0gZnVuY3Rpb24gKHZhbHVlLCBzdGFydCwgZW5kKSB7XG4gIGlmICghdmFsdWUpIHZhbHVlID0gMFxuICBpZiAoIXN0YXJ0KSBzdGFydCA9IDBcbiAgaWYgKCFlbmQpIGVuZCA9IHRoaXMubGVuZ3RoXG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICB2YWx1ZSA9IHZhbHVlLmNoYXJDb2RlQXQoMClcbiAgfVxuXG4gIGFzc2VydCh0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInICYmICFpc05hTih2YWx1ZSksICd2YWx1ZSBpcyBub3QgYSBudW1iZXInKVxuICBhc3NlcnQoZW5kID49IHN0YXJ0LCAnZW5kIDwgc3RhcnQnKVxuXG4gIC8vIEZpbGwgMCBieXRlczsgd2UncmUgZG9uZVxuICBpZiAoZW5kID09PSBzdGFydCkgcmV0dXJuXG4gIGlmICh0aGlzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgYXNzZXJ0KHN0YXJ0ID49IDAgJiYgc3RhcnQgPCB0aGlzLmxlbmd0aCwgJ3N0YXJ0IG91dCBvZiBib3VuZHMnKVxuICBhc3NlcnQoZW5kID49IDAgJiYgZW5kIDw9IHRoaXMubGVuZ3RoLCAnZW5kIG91dCBvZiBib3VuZHMnKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgdGhpc1tpXSA9IHZhbHVlXG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS5pbnNwZWN0ID0gZnVuY3Rpb24gKCkge1xuICB2YXIgb3V0ID0gW11cbiAgdmFyIGxlbiA9IHRoaXMubGVuZ3RoXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyBpKyspIHtcbiAgICBvdXRbaV0gPSB0b0hleCh0aGlzW2ldKVxuICAgIGlmIChpID09PSBleHBvcnRzLklOU1BFQ1RfTUFYX0JZVEVTKSB7XG4gICAgICBvdXRbaSArIDFdID0gJy4uLidcbiAgICAgIGJyZWFrXG4gICAgfVxuICB9XG4gIHJldHVybiAnPEJ1ZmZlciAnICsgb3V0LmpvaW4oJyAnKSArICc+J1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYSBuZXcgYEFycmF5QnVmZmVyYCB3aXRoIHRoZSAqY29waWVkKiBtZW1vcnkgb2YgdGhlIGJ1ZmZlciBpbnN0YW5jZS5cbiAqIEFkZGVkIGluIE5vZGUgMC4xMi4gT25seSBhdmFpbGFibGUgaW4gYnJvd3NlcnMgdGhhdCBzdXBwb3J0IEFycmF5QnVmZmVyLlxuICovXG5CdWZmZXIucHJvdG90eXBlLnRvQXJyYXlCdWZmZXIgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2YgVWludDhBcnJheSAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBpZiAoQnVmZmVyLl91c2VUeXBlZEFycmF5cykge1xuICAgICAgcmV0dXJuIChuZXcgQnVmZmVyKHRoaXMpKS5idWZmZXJcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIGJ1ZiA9IG5ldyBVaW50OEFycmF5KHRoaXMubGVuZ3RoKVxuICAgICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGJ1Zi5sZW5ndGg7IGkgPCBsZW47IGkgKz0gMSlcbiAgICAgICAgYnVmW2ldID0gdGhpc1tpXVxuICAgICAgcmV0dXJuIGJ1Zi5idWZmZXJcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdCdWZmZXIudG9BcnJheUJ1ZmZlciBub3Qgc3VwcG9ydGVkIGluIHRoaXMgYnJvd3NlcicpXG4gIH1cbn1cblxuLy8gSEVMUEVSIEZVTkNUSU9OU1xuLy8gPT09PT09PT09PT09PT09PVxuXG5mdW5jdGlvbiBzdHJpbmd0cmltIChzdHIpIHtcbiAgaWYgKHN0ci50cmltKSByZXR1cm4gc3RyLnRyaW0oKVxuICByZXR1cm4gc3RyLnJlcGxhY2UoL15cXHMrfFxccyskL2csICcnKVxufVxuXG52YXIgQlAgPSBCdWZmZXIucHJvdG90eXBlXG5cbi8qKlxuICogQXVnbWVudCBhIFVpbnQ4QXJyYXkgKmluc3RhbmNlKiAobm90IHRoZSBVaW50OEFycmF5IGNsYXNzISkgd2l0aCBCdWZmZXIgbWV0aG9kc1xuICovXG5CdWZmZXIuX2F1Z21lbnQgPSBmdW5jdGlvbiAoYXJyKSB7XG4gIGFyci5faXNCdWZmZXIgPSB0cnVlXG5cbiAgLy8gc2F2ZSByZWZlcmVuY2UgdG8gb3JpZ2luYWwgVWludDhBcnJheSBnZXQvc2V0IG1ldGhvZHMgYmVmb3JlIG92ZXJ3cml0aW5nXG4gIGFyci5fZ2V0ID0gYXJyLmdldFxuICBhcnIuX3NldCA9IGFyci5zZXRcblxuICAvLyBkZXByZWNhdGVkLCB3aWxsIGJlIHJlbW92ZWQgaW4gbm9kZSAwLjEzK1xuICBhcnIuZ2V0ID0gQlAuZ2V0XG4gIGFyci5zZXQgPSBCUC5zZXRcblxuICBhcnIud3JpdGUgPSBCUC53cml0ZVxuICBhcnIudG9TdHJpbmcgPSBCUC50b1N0cmluZ1xuICBhcnIudG9Mb2NhbGVTdHJpbmcgPSBCUC50b1N0cmluZ1xuICBhcnIudG9KU09OID0gQlAudG9KU09OXG4gIGFyci5jb3B5ID0gQlAuY29weVxuICBhcnIuc2xpY2UgPSBCUC5zbGljZVxuICBhcnIucmVhZFVJbnQ4ID0gQlAucmVhZFVJbnQ4XG4gIGFyci5yZWFkVUludDE2TEUgPSBCUC5yZWFkVUludDE2TEVcbiAgYXJyLnJlYWRVSW50MTZCRSA9IEJQLnJlYWRVSW50MTZCRVxuICBhcnIucmVhZFVJbnQzMkxFID0gQlAucmVhZFVJbnQzMkxFXG4gIGFyci5yZWFkVUludDMyQkUgPSBCUC5yZWFkVUludDMyQkVcbiAgYXJyLnJlYWRJbnQ4ID0gQlAucmVhZEludDhcbiAgYXJyLnJlYWRJbnQxNkxFID0gQlAucmVhZEludDE2TEVcbiAgYXJyLnJlYWRJbnQxNkJFID0gQlAucmVhZEludDE2QkVcbiAgYXJyLnJlYWRJbnQzMkxFID0gQlAucmVhZEludDMyTEVcbiAgYXJyLnJlYWRJbnQzMkJFID0gQlAucmVhZEludDMyQkVcbiAgYXJyLnJlYWRGbG9hdExFID0gQlAucmVhZEZsb2F0TEVcbiAgYXJyLnJlYWRGbG9hdEJFID0gQlAucmVhZEZsb2F0QkVcbiAgYXJyLnJlYWREb3VibGVMRSA9IEJQLnJlYWREb3VibGVMRVxuICBhcnIucmVhZERvdWJsZUJFID0gQlAucmVhZERvdWJsZUJFXG4gIGFyci53cml0ZVVJbnQ4ID0gQlAud3JpdGVVSW50OFxuICBhcnIud3JpdGVVSW50MTZMRSA9IEJQLndyaXRlVUludDE2TEVcbiAgYXJyLndyaXRlVUludDE2QkUgPSBCUC53cml0ZVVJbnQxNkJFXG4gIGFyci53cml0ZVVJbnQzMkxFID0gQlAud3JpdGVVSW50MzJMRVxuICBhcnIud3JpdGVVSW50MzJCRSA9IEJQLndyaXRlVUludDMyQkVcbiAgYXJyLndyaXRlSW50OCA9IEJQLndyaXRlSW50OFxuICBhcnIud3JpdGVJbnQxNkxFID0gQlAud3JpdGVJbnQxNkxFXG4gIGFyci53cml0ZUludDE2QkUgPSBCUC53cml0ZUludDE2QkVcbiAgYXJyLndyaXRlSW50MzJMRSA9IEJQLndyaXRlSW50MzJMRVxuICBhcnIud3JpdGVJbnQzMkJFID0gQlAud3JpdGVJbnQzMkJFXG4gIGFyci53cml0ZUZsb2F0TEUgPSBCUC53cml0ZUZsb2F0TEVcbiAgYXJyLndyaXRlRmxvYXRCRSA9IEJQLndyaXRlRmxvYXRCRVxuICBhcnIud3JpdGVEb3VibGVMRSA9IEJQLndyaXRlRG91YmxlTEVcbiAgYXJyLndyaXRlRG91YmxlQkUgPSBCUC53cml0ZURvdWJsZUJFXG4gIGFyci5maWxsID0gQlAuZmlsbFxuICBhcnIuaW5zcGVjdCA9IEJQLmluc3BlY3RcbiAgYXJyLnRvQXJyYXlCdWZmZXIgPSBCUC50b0FycmF5QnVmZmVyXG5cbiAgcmV0dXJuIGFyclxufVxuXG4vLyBzbGljZShzdGFydCwgZW5kKVxuZnVuY3Rpb24gY2xhbXAgKGluZGV4LCBsZW4sIGRlZmF1bHRWYWx1ZSkge1xuICBpZiAodHlwZW9mIGluZGV4ICE9PSAnbnVtYmVyJykgcmV0dXJuIGRlZmF1bHRWYWx1ZVxuICBpbmRleCA9IH5+aW5kZXg7ICAvLyBDb2VyY2UgdG8gaW50ZWdlci5cbiAgaWYgKGluZGV4ID49IGxlbikgcmV0dXJuIGxlblxuICBpZiAoaW5kZXggPj0gMCkgcmV0dXJuIGluZGV4XG4gIGluZGV4ICs9IGxlblxuICBpZiAoaW5kZXggPj0gMCkgcmV0dXJuIGluZGV4XG4gIHJldHVybiAwXG59XG5cbmZ1bmN0aW9uIGNvZXJjZSAobGVuZ3RoKSB7XG4gIC8vIENvZXJjZSBsZW5ndGggdG8gYSBudW1iZXIgKHBvc3NpYmx5IE5hTiksIHJvdW5kIHVwXG4gIC8vIGluIGNhc2UgaXQncyBmcmFjdGlvbmFsIChlLmcuIDEyMy40NTYpIHRoZW4gZG8gYVxuICAvLyBkb3VibGUgbmVnYXRlIHRvIGNvZXJjZSBhIE5hTiB0byAwLiBFYXN5LCByaWdodD9cbiAgbGVuZ3RoID0gfn5NYXRoLmNlaWwoK2xlbmd0aClcbiAgcmV0dXJuIGxlbmd0aCA8IDAgPyAwIDogbGVuZ3RoXG59XG5cbmZ1bmN0aW9uIGlzQXJyYXkgKHN1YmplY3QpIHtcbiAgcmV0dXJuIChBcnJheS5pc0FycmF5IHx8IGZ1bmN0aW9uIChzdWJqZWN0KSB7XG4gICAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChzdWJqZWN0KSA9PT0gJ1tvYmplY3QgQXJyYXldJ1xuICB9KShzdWJqZWN0KVxufVxuXG5mdW5jdGlvbiBpc0FycmF5aXNoIChzdWJqZWN0KSB7XG4gIHJldHVybiBpc0FycmF5KHN1YmplY3QpIHx8IEJ1ZmZlci5pc0J1ZmZlcihzdWJqZWN0KSB8fFxuICAgICAgc3ViamVjdCAmJiB0eXBlb2Ygc3ViamVjdCA9PT0gJ29iamVjdCcgJiZcbiAgICAgIHR5cGVvZiBzdWJqZWN0Lmxlbmd0aCA9PT0gJ251bWJlcidcbn1cblxuZnVuY3Rpb24gdG9IZXggKG4pIHtcbiAgaWYgKG4gPCAxNikgcmV0dXJuICcwJyArIG4udG9TdHJpbmcoMTYpXG4gIHJldHVybiBuLnRvU3RyaW5nKDE2KVxufVxuXG5mdW5jdGlvbiB1dGY4VG9CeXRlcyAoc3RyKSB7XG4gIHZhciBieXRlQXJyYXkgPSBbXVxuICBmb3IgKHZhciBpID0gMDsgaSA8IHN0ci5sZW5ndGg7IGkrKykge1xuICAgIHZhciBiID0gc3RyLmNoYXJDb2RlQXQoaSlcbiAgICBpZiAoYiA8PSAweDdGKVxuICAgICAgYnl0ZUFycmF5LnB1c2goc3RyLmNoYXJDb2RlQXQoaSkpXG4gICAgZWxzZSB7XG4gICAgICB2YXIgc3RhcnQgPSBpXG4gICAgICBpZiAoYiA+PSAweEQ4MDAgJiYgYiA8PSAweERGRkYpIGkrK1xuICAgICAgdmFyIGggPSBlbmNvZGVVUklDb21wb25lbnQoc3RyLnNsaWNlKHN0YXJ0LCBpKzEpKS5zdWJzdHIoMSkuc3BsaXQoJyUnKVxuICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBoLmxlbmd0aDsgaisrKVxuICAgICAgICBieXRlQXJyYXkucHVzaChwYXJzZUludChoW2pdLCAxNikpXG4gICAgfVxuICB9XG4gIHJldHVybiBieXRlQXJyYXlcbn1cblxuZnVuY3Rpb24gYXNjaWlUb0J5dGVzIChzdHIpIHtcbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgLy8gTm9kZSdzIGNvZGUgc2VlbXMgdG8gYmUgZG9pbmcgdGhpcyBhbmQgbm90ICYgMHg3Ri4uXG4gICAgYnl0ZUFycmF5LnB1c2goc3RyLmNoYXJDb2RlQXQoaSkgJiAweEZGKVxuICB9XG4gIHJldHVybiBieXRlQXJyYXlcbn1cblxuZnVuY3Rpb24gdXRmMTZsZVRvQnl0ZXMgKHN0cikge1xuICB2YXIgYywgaGksIGxvXG4gIHZhciBieXRlQXJyYXkgPSBbXVxuICBmb3IgKHZhciBpID0gMDsgaSA8IHN0ci5sZW5ndGg7IGkrKykge1xuICAgIGMgPSBzdHIuY2hhckNvZGVBdChpKVxuICAgIGhpID0gYyA+PiA4XG4gICAgbG8gPSBjICUgMjU2XG4gICAgYnl0ZUFycmF5LnB1c2gobG8pXG4gICAgYnl0ZUFycmF5LnB1c2goaGkpXG4gIH1cblxuICByZXR1cm4gYnl0ZUFycmF5XG59XG5cbmZ1bmN0aW9uIGJhc2U2NFRvQnl0ZXMgKHN0cikge1xuICByZXR1cm4gYmFzZTY0LnRvQnl0ZUFycmF5KHN0cilcbn1cblxuZnVuY3Rpb24gYmxpdEJ1ZmZlciAoc3JjLCBkc3QsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHZhciBwb3NcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIGlmICgoaSArIG9mZnNldCA+PSBkc3QubGVuZ3RoKSB8fCAoaSA+PSBzcmMubGVuZ3RoKSlcbiAgICAgIGJyZWFrXG4gICAgZHN0W2kgKyBvZmZzZXRdID0gc3JjW2ldXG4gIH1cbiAgcmV0dXJuIGlcbn1cblxuZnVuY3Rpb24gZGVjb2RlVXRmOENoYXIgKHN0cikge1xuICB0cnkge1xuICAgIHJldHVybiBkZWNvZGVVUklDb21wb25lbnQoc3RyKVxuICB9IGNhdGNoIChlcnIpIHtcbiAgICByZXR1cm4gU3RyaW5nLmZyb21DaGFyQ29kZSgweEZGRkQpIC8vIFVURiA4IGludmFsaWQgY2hhclxuICB9XG59XG5cbi8qXG4gKiBXZSBoYXZlIHRvIG1ha2Ugc3VyZSB0aGF0IHRoZSB2YWx1ZSBpcyBhIHZhbGlkIGludGVnZXIuIFRoaXMgbWVhbnMgdGhhdCBpdFxuICogaXMgbm9uLW5lZ2F0aXZlLiBJdCBoYXMgbm8gZnJhY3Rpb25hbCBjb21wb25lbnQgYW5kIHRoYXQgaXQgZG9lcyBub3RcbiAqIGV4Y2VlZCB0aGUgbWF4aW11bSBhbGxvd2VkIHZhbHVlLlxuICovXG5mdW5jdGlvbiB2ZXJpZnVpbnQgKHZhbHVlLCBtYXgpIHtcbiAgYXNzZXJ0KHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicsICdjYW5ub3Qgd3JpdGUgYSBub24tbnVtYmVyIGFzIGEgbnVtYmVyJylcbiAgYXNzZXJ0KHZhbHVlID49IDAsICdzcGVjaWZpZWQgYSBuZWdhdGl2ZSB2YWx1ZSBmb3Igd3JpdGluZyBhbiB1bnNpZ25lZCB2YWx1ZScpXG4gIGFzc2VydCh2YWx1ZSA8PSBtYXgsICd2YWx1ZSBpcyBsYXJnZXIgdGhhbiBtYXhpbXVtIHZhbHVlIGZvciB0eXBlJylcbiAgYXNzZXJ0KE1hdGguZmxvb3IodmFsdWUpID09PSB2YWx1ZSwgJ3ZhbHVlIGhhcyBhIGZyYWN0aW9uYWwgY29tcG9uZW50Jylcbn1cblxuZnVuY3Rpb24gdmVyaWZzaW50ICh2YWx1ZSwgbWF4LCBtaW4pIHtcbiAgYXNzZXJ0KHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicsICdjYW5ub3Qgd3JpdGUgYSBub24tbnVtYmVyIGFzIGEgbnVtYmVyJylcbiAgYXNzZXJ0KHZhbHVlIDw9IG1heCwgJ3ZhbHVlIGxhcmdlciB0aGFuIG1heGltdW0gYWxsb3dlZCB2YWx1ZScpXG4gIGFzc2VydCh2YWx1ZSA+PSBtaW4sICd2YWx1ZSBzbWFsbGVyIHRoYW4gbWluaW11bSBhbGxvd2VkIHZhbHVlJylcbiAgYXNzZXJ0KE1hdGguZmxvb3IodmFsdWUpID09PSB2YWx1ZSwgJ3ZhbHVlIGhhcyBhIGZyYWN0aW9uYWwgY29tcG9uZW50Jylcbn1cblxuZnVuY3Rpb24gdmVyaWZJRUVFNzU0ICh2YWx1ZSwgbWF4LCBtaW4pIHtcbiAgYXNzZXJ0KHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicsICdjYW5ub3Qgd3JpdGUgYSBub24tbnVtYmVyIGFzIGEgbnVtYmVyJylcbiAgYXNzZXJ0KHZhbHVlIDw9IG1heCwgJ3ZhbHVlIGxhcmdlciB0aGFuIG1heGltdW0gYWxsb3dlZCB2YWx1ZScpXG4gIGFzc2VydCh2YWx1ZSA+PSBtaW4sICd2YWx1ZSBzbWFsbGVyIHRoYW4gbWluaW11bSBhbGxvd2VkIHZhbHVlJylcbn1cblxuZnVuY3Rpb24gYXNzZXJ0ICh0ZXN0LCBtZXNzYWdlKSB7XG4gIGlmICghdGVzdCkgdGhyb3cgbmV3IEVycm9yKG1lc3NhZ2UgfHwgJ0ZhaWxlZCBhc3NlcnRpb24nKVxufVxuXG59KS5jYWxsKHRoaXMscmVxdWlyZShcIm9NZnBBblwiKSx0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiLy4uLy4uL25vZGVfbW9kdWxlcy9ndWxwLWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9pbmRleC5qc1wiLFwiLy4uLy4uL25vZGVfbW9kdWxlcy9ndWxwLWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlclwiKSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbnZhciBsb29rdXAgPSAnQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODkrLyc7XG5cbjsoZnVuY3Rpb24gKGV4cG9ydHMpIHtcblx0J3VzZSBzdHJpY3QnO1xuXG4gIHZhciBBcnIgPSAodHlwZW9mIFVpbnQ4QXJyYXkgIT09ICd1bmRlZmluZWQnKVxuICAgID8gVWludDhBcnJheVxuICAgIDogQXJyYXlcblxuXHR2YXIgUExVUyAgID0gJysnLmNoYXJDb2RlQXQoMClcblx0dmFyIFNMQVNIICA9ICcvJy5jaGFyQ29kZUF0KDApXG5cdHZhciBOVU1CRVIgPSAnMCcuY2hhckNvZGVBdCgwKVxuXHR2YXIgTE9XRVIgID0gJ2EnLmNoYXJDb2RlQXQoMClcblx0dmFyIFVQUEVSICA9ICdBJy5jaGFyQ29kZUF0KDApXG5cdHZhciBQTFVTX1VSTF9TQUZFID0gJy0nLmNoYXJDb2RlQXQoMClcblx0dmFyIFNMQVNIX1VSTF9TQUZFID0gJ18nLmNoYXJDb2RlQXQoMClcblxuXHRmdW5jdGlvbiBkZWNvZGUgKGVsdCkge1xuXHRcdHZhciBjb2RlID0gZWx0LmNoYXJDb2RlQXQoMClcblx0XHRpZiAoY29kZSA9PT0gUExVUyB8fFxuXHRcdCAgICBjb2RlID09PSBQTFVTX1VSTF9TQUZFKVxuXHRcdFx0cmV0dXJuIDYyIC8vICcrJ1xuXHRcdGlmIChjb2RlID09PSBTTEFTSCB8fFxuXHRcdCAgICBjb2RlID09PSBTTEFTSF9VUkxfU0FGRSlcblx0XHRcdHJldHVybiA2MyAvLyAnLydcblx0XHRpZiAoY29kZSA8IE5VTUJFUilcblx0XHRcdHJldHVybiAtMSAvL25vIG1hdGNoXG5cdFx0aWYgKGNvZGUgPCBOVU1CRVIgKyAxMClcblx0XHRcdHJldHVybiBjb2RlIC0gTlVNQkVSICsgMjYgKyAyNlxuXHRcdGlmIChjb2RlIDwgVVBQRVIgKyAyNilcblx0XHRcdHJldHVybiBjb2RlIC0gVVBQRVJcblx0XHRpZiAoY29kZSA8IExPV0VSICsgMjYpXG5cdFx0XHRyZXR1cm4gY29kZSAtIExPV0VSICsgMjZcblx0fVxuXG5cdGZ1bmN0aW9uIGI2NFRvQnl0ZUFycmF5IChiNjQpIHtcblx0XHR2YXIgaSwgaiwgbCwgdG1wLCBwbGFjZUhvbGRlcnMsIGFyclxuXG5cdFx0aWYgKGI2NC5sZW5ndGggJSA0ID4gMCkge1xuXHRcdFx0dGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIHN0cmluZy4gTGVuZ3RoIG11c3QgYmUgYSBtdWx0aXBsZSBvZiA0Jylcblx0XHR9XG5cblx0XHQvLyB0aGUgbnVtYmVyIG9mIGVxdWFsIHNpZ25zIChwbGFjZSBob2xkZXJzKVxuXHRcdC8vIGlmIHRoZXJlIGFyZSB0d28gcGxhY2Vob2xkZXJzLCB0aGFuIHRoZSB0d28gY2hhcmFjdGVycyBiZWZvcmUgaXRcblx0XHQvLyByZXByZXNlbnQgb25lIGJ5dGVcblx0XHQvLyBpZiB0aGVyZSBpcyBvbmx5IG9uZSwgdGhlbiB0aGUgdGhyZWUgY2hhcmFjdGVycyBiZWZvcmUgaXQgcmVwcmVzZW50IDIgYnl0ZXNcblx0XHQvLyB0aGlzIGlzIGp1c3QgYSBjaGVhcCBoYWNrIHRvIG5vdCBkbyBpbmRleE9mIHR3aWNlXG5cdFx0dmFyIGxlbiA9IGI2NC5sZW5ndGhcblx0XHRwbGFjZUhvbGRlcnMgPSAnPScgPT09IGI2NC5jaGFyQXQobGVuIC0gMikgPyAyIDogJz0nID09PSBiNjQuY2hhckF0KGxlbiAtIDEpID8gMSA6IDBcblxuXHRcdC8vIGJhc2U2NCBpcyA0LzMgKyB1cCB0byB0d28gY2hhcmFjdGVycyBvZiB0aGUgb3JpZ2luYWwgZGF0YVxuXHRcdGFyciA9IG5ldyBBcnIoYjY0Lmxlbmd0aCAqIDMgLyA0IC0gcGxhY2VIb2xkZXJzKVxuXG5cdFx0Ly8gaWYgdGhlcmUgYXJlIHBsYWNlaG9sZGVycywgb25seSBnZXQgdXAgdG8gdGhlIGxhc3QgY29tcGxldGUgNCBjaGFyc1xuXHRcdGwgPSBwbGFjZUhvbGRlcnMgPiAwID8gYjY0Lmxlbmd0aCAtIDQgOiBiNjQubGVuZ3RoXG5cblx0XHR2YXIgTCA9IDBcblxuXHRcdGZ1bmN0aW9uIHB1c2ggKHYpIHtcblx0XHRcdGFycltMKytdID0gdlxuXHRcdH1cblxuXHRcdGZvciAoaSA9IDAsIGogPSAwOyBpIDwgbDsgaSArPSA0LCBqICs9IDMpIHtcblx0XHRcdHRtcCA9IChkZWNvZGUoYjY0LmNoYXJBdChpKSkgPDwgMTgpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPDwgMTIpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAyKSkgPDwgNikgfCBkZWNvZGUoYjY0LmNoYXJBdChpICsgMykpXG5cdFx0XHRwdXNoKCh0bXAgJiAweEZGMDAwMCkgPj4gMTYpXG5cdFx0XHRwdXNoKCh0bXAgJiAweEZGMDApID4+IDgpXG5cdFx0XHRwdXNoKHRtcCAmIDB4RkYpXG5cdFx0fVxuXG5cdFx0aWYgKHBsYWNlSG9sZGVycyA9PT0gMikge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAyKSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMSkpID4+IDQpXG5cdFx0XHRwdXNoKHRtcCAmIDB4RkYpXG5cdFx0fSBlbHNlIGlmIChwbGFjZUhvbGRlcnMgPT09IDEpIHtcblx0XHRcdHRtcCA9IChkZWNvZGUoYjY0LmNoYXJBdChpKSkgPDwgMTApIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPDwgNCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDIpKSA+PiAyKVxuXHRcdFx0cHVzaCgodG1wID4+IDgpICYgMHhGRilcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9XG5cblx0XHRyZXR1cm4gYXJyXG5cdH1cblxuXHRmdW5jdGlvbiB1aW50OFRvQmFzZTY0ICh1aW50OCkge1xuXHRcdHZhciBpLFxuXHRcdFx0ZXh0cmFCeXRlcyA9IHVpbnQ4Lmxlbmd0aCAlIDMsIC8vIGlmIHdlIGhhdmUgMSBieXRlIGxlZnQsIHBhZCAyIGJ5dGVzXG5cdFx0XHRvdXRwdXQgPSBcIlwiLFxuXHRcdFx0dGVtcCwgbGVuZ3RoXG5cblx0XHRmdW5jdGlvbiBlbmNvZGUgKG51bSkge1xuXHRcdFx0cmV0dXJuIGxvb2t1cC5jaGFyQXQobnVtKVxuXHRcdH1cblxuXHRcdGZ1bmN0aW9uIHRyaXBsZXRUb0Jhc2U2NCAobnVtKSB7XG5cdFx0XHRyZXR1cm4gZW5jb2RlKG51bSA+PiAxOCAmIDB4M0YpICsgZW5jb2RlKG51bSA+PiAxMiAmIDB4M0YpICsgZW5jb2RlKG51bSA+PiA2ICYgMHgzRikgKyBlbmNvZGUobnVtICYgMHgzRilcblx0XHR9XG5cblx0XHQvLyBnbyB0aHJvdWdoIHRoZSBhcnJheSBldmVyeSB0aHJlZSBieXRlcywgd2UnbGwgZGVhbCB3aXRoIHRyYWlsaW5nIHN0dWZmIGxhdGVyXG5cdFx0Zm9yIChpID0gMCwgbGVuZ3RoID0gdWludDgubGVuZ3RoIC0gZXh0cmFCeXRlczsgaSA8IGxlbmd0aDsgaSArPSAzKSB7XG5cdFx0XHR0ZW1wID0gKHVpbnQ4W2ldIDw8IDE2KSArICh1aW50OFtpICsgMV0gPDwgOCkgKyAodWludDhbaSArIDJdKVxuXHRcdFx0b3V0cHV0ICs9IHRyaXBsZXRUb0Jhc2U2NCh0ZW1wKVxuXHRcdH1cblxuXHRcdC8vIHBhZCB0aGUgZW5kIHdpdGggemVyb3MsIGJ1dCBtYWtlIHN1cmUgdG8gbm90IGZvcmdldCB0aGUgZXh0cmEgYnl0ZXNcblx0XHRzd2l0Y2ggKGV4dHJhQnl0ZXMpIHtcblx0XHRcdGNhc2UgMTpcblx0XHRcdFx0dGVtcCA9IHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDFdXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUodGVtcCA+PiAyKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wIDw8IDQpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9ICc9PSdcblx0XHRcdFx0YnJlYWtcblx0XHRcdGNhc2UgMjpcblx0XHRcdFx0dGVtcCA9ICh1aW50OFt1aW50OC5sZW5ndGggLSAyXSA8PCA4KSArICh1aW50OFt1aW50OC5sZW5ndGggLSAxXSlcblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSh0ZW1wID4+IDEwKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wID4+IDQpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSgodGVtcCA8PCAyKSAmIDB4M0YpXG5cdFx0XHRcdG91dHB1dCArPSAnPSdcblx0XHRcdFx0YnJlYWtcblx0XHR9XG5cblx0XHRyZXR1cm4gb3V0cHV0XG5cdH1cblxuXHRleHBvcnRzLnRvQnl0ZUFycmF5ID0gYjY0VG9CeXRlQXJyYXlcblx0ZXhwb3J0cy5mcm9tQnl0ZUFycmF5ID0gdWludDhUb0Jhc2U2NFxufSh0eXBlb2YgZXhwb3J0cyA9PT0gJ3VuZGVmaW5lZCcgPyAodGhpcy5iYXNlNjRqcyA9IHt9KSA6IGV4cG9ydHMpKVxuXG59KS5jYWxsKHRoaXMscmVxdWlyZShcIm9NZnBBblwiKSx0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiLy4uLy4uL25vZGVfbW9kdWxlcy9ndWxwLWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvYmFzZTY0LWpzL2xpYi9iNjQuanNcIixcIi8uLi8uLi9ub2RlX21vZHVsZXMvZ3VscC1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2Jhc2U2NC1qcy9saWJcIikiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG5leHBvcnRzLnJlYWQgPSBmdW5jdGlvbiAoYnVmZmVyLCBvZmZzZXQsIGlzTEUsIG1MZW4sIG5CeXRlcykge1xuICB2YXIgZSwgbVxuICB2YXIgZUxlbiA9IG5CeXRlcyAqIDggLSBtTGVuIC0gMVxuICB2YXIgZU1heCA9ICgxIDw8IGVMZW4pIC0gMVxuICB2YXIgZUJpYXMgPSBlTWF4ID4+IDFcbiAgdmFyIG5CaXRzID0gLTdcbiAgdmFyIGkgPSBpc0xFID8gKG5CeXRlcyAtIDEpIDogMFxuICB2YXIgZCA9IGlzTEUgPyAtMSA6IDFcbiAgdmFyIHMgPSBidWZmZXJbb2Zmc2V0ICsgaV1cblxuICBpICs9IGRcblxuICBlID0gcyAmICgoMSA8PCAoLW5CaXRzKSkgLSAxKVxuICBzID4+PSAoLW5CaXRzKVxuICBuQml0cyArPSBlTGVuXG4gIGZvciAoOyBuQml0cyA+IDA7IGUgPSBlICogMjU2ICsgYnVmZmVyW29mZnNldCArIGldLCBpICs9IGQsIG5CaXRzIC09IDgpIHt9XG5cbiAgbSA9IGUgJiAoKDEgPDwgKC1uQml0cykpIC0gMSlcbiAgZSA+Pj0gKC1uQml0cylcbiAgbkJpdHMgKz0gbUxlblxuICBmb3IgKDsgbkJpdHMgPiAwOyBtID0gbSAqIDI1NiArIGJ1ZmZlcltvZmZzZXQgKyBpXSwgaSArPSBkLCBuQml0cyAtPSA4KSB7fVxuXG4gIGlmIChlID09PSAwKSB7XG4gICAgZSA9IDEgLSBlQmlhc1xuICB9IGVsc2UgaWYgKGUgPT09IGVNYXgpIHtcbiAgICByZXR1cm4gbSA/IE5hTiA6ICgocyA/IC0xIDogMSkgKiBJbmZpbml0eSlcbiAgfSBlbHNlIHtcbiAgICBtID0gbSArIE1hdGgucG93KDIsIG1MZW4pXG4gICAgZSA9IGUgLSBlQmlhc1xuICB9XG4gIHJldHVybiAocyA/IC0xIDogMSkgKiBtICogTWF0aC5wb3coMiwgZSAtIG1MZW4pXG59XG5cbmV4cG9ydHMud3JpdGUgPSBmdW5jdGlvbiAoYnVmZmVyLCB2YWx1ZSwgb2Zmc2V0LCBpc0xFLCBtTGVuLCBuQnl0ZXMpIHtcbiAgdmFyIGUsIG0sIGNcbiAgdmFyIGVMZW4gPSBuQnl0ZXMgKiA4IC0gbUxlbiAtIDFcbiAgdmFyIGVNYXggPSAoMSA8PCBlTGVuKSAtIDFcbiAgdmFyIGVCaWFzID0gZU1heCA+PiAxXG4gIHZhciBydCA9IChtTGVuID09PSAyMyA/IE1hdGgucG93KDIsIC0yNCkgLSBNYXRoLnBvdygyLCAtNzcpIDogMClcbiAgdmFyIGkgPSBpc0xFID8gMCA6IChuQnl0ZXMgLSAxKVxuICB2YXIgZCA9IGlzTEUgPyAxIDogLTFcbiAgdmFyIHMgPSB2YWx1ZSA8IDAgfHwgKHZhbHVlID09PSAwICYmIDEgLyB2YWx1ZSA8IDApID8gMSA6IDBcblxuICB2YWx1ZSA9IE1hdGguYWJzKHZhbHVlKVxuXG4gIGlmIChpc05hTih2YWx1ZSkgfHwgdmFsdWUgPT09IEluZmluaXR5KSB7XG4gICAgbSA9IGlzTmFOKHZhbHVlKSA/IDEgOiAwXG4gICAgZSA9IGVNYXhcbiAgfSBlbHNlIHtcbiAgICBlID0gTWF0aC5mbG9vcihNYXRoLmxvZyh2YWx1ZSkgLyBNYXRoLkxOMilcbiAgICBpZiAodmFsdWUgKiAoYyA9IE1hdGgucG93KDIsIC1lKSkgPCAxKSB7XG4gICAgICBlLS1cbiAgICAgIGMgKj0gMlxuICAgIH1cbiAgICBpZiAoZSArIGVCaWFzID49IDEpIHtcbiAgICAgIHZhbHVlICs9IHJ0IC8gY1xuICAgIH0gZWxzZSB7XG4gICAgICB2YWx1ZSArPSBydCAqIE1hdGgucG93KDIsIDEgLSBlQmlhcylcbiAgICB9XG4gICAgaWYgKHZhbHVlICogYyA+PSAyKSB7XG4gICAgICBlKytcbiAgICAgIGMgLz0gMlxuICAgIH1cblxuICAgIGlmIChlICsgZUJpYXMgPj0gZU1heCkge1xuICAgICAgbSA9IDBcbiAgICAgIGUgPSBlTWF4XG4gICAgfSBlbHNlIGlmIChlICsgZUJpYXMgPj0gMSkge1xuICAgICAgbSA9ICh2YWx1ZSAqIGMgLSAxKSAqIE1hdGgucG93KDIsIG1MZW4pXG4gICAgICBlID0gZSArIGVCaWFzXG4gICAgfSBlbHNlIHtcbiAgICAgIG0gPSB2YWx1ZSAqIE1hdGgucG93KDIsIGVCaWFzIC0gMSkgKiBNYXRoLnBvdygyLCBtTGVuKVxuICAgICAgZSA9IDBcbiAgICB9XG4gIH1cblxuICBmb3IgKDsgbUxlbiA+PSA4OyBidWZmZXJbb2Zmc2V0ICsgaV0gPSBtICYgMHhmZiwgaSArPSBkLCBtIC89IDI1NiwgbUxlbiAtPSA4KSB7fVxuXG4gIGUgPSAoZSA8PCBtTGVuKSB8IG1cbiAgZUxlbiArPSBtTGVuXG4gIGZvciAoOyBlTGVuID4gMDsgYnVmZmVyW29mZnNldCArIGldID0gZSAmIDB4ZmYsIGkgKz0gZCwgZSAvPSAyNTYsIGVMZW4gLT0gOCkge31cblxuICBidWZmZXJbb2Zmc2V0ICsgaSAtIGRdIHw9IHMgKiAxMjhcbn1cblxufSkuY2FsbCh0aGlzLHJlcXVpcmUoXCJvTWZwQW5cIiksdHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIgPyBzZWxmIDogdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHt9LHJlcXVpcmUoXCJidWZmZXJcIikuQnVmZmVyLGFyZ3VtZW50c1szXSxhcmd1bWVudHNbNF0sYXJndW1lbnRzWzVdLGFyZ3VtZW50c1s2XSxcIi8uLi8uLi9ub2RlX21vZHVsZXMvZ3VscC1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2llZWU3NTQvaW5kZXguanNcIixcIi8uLi8uLi9ub2RlX21vZHVsZXMvZ3VscC1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2llZWU3NTRcIikiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG4vLyBzaGltIGZvciB1c2luZyBwcm9jZXNzIGluIGJyb3dzZXJcblxudmFyIHByb2Nlc3MgPSBtb2R1bGUuZXhwb3J0cyA9IHt9O1xuXG5wcm9jZXNzLm5leHRUaWNrID0gKGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgY2FuU2V0SW1tZWRpYXRlID0gdHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCdcbiAgICAmJiB3aW5kb3cuc2V0SW1tZWRpYXRlO1xuICAgIHZhciBjYW5Qb3N0ID0gdHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCdcbiAgICAmJiB3aW5kb3cucG9zdE1lc3NhZ2UgJiYgd2luZG93LmFkZEV2ZW50TGlzdGVuZXJcbiAgICA7XG5cbiAgICBpZiAoY2FuU2V0SW1tZWRpYXRlKSB7XG4gICAgICAgIHJldHVybiBmdW5jdGlvbiAoZikgeyByZXR1cm4gd2luZG93LnNldEltbWVkaWF0ZShmKSB9O1xuICAgIH1cblxuICAgIGlmIChjYW5Qb3N0KSB7XG4gICAgICAgIHZhciBxdWV1ZSA9IFtdO1xuICAgICAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIGZ1bmN0aW9uIChldikge1xuICAgICAgICAgICAgdmFyIHNvdXJjZSA9IGV2LnNvdXJjZTtcbiAgICAgICAgICAgIGlmICgoc291cmNlID09PSB3aW5kb3cgfHwgc291cmNlID09PSBudWxsKSAmJiBldi5kYXRhID09PSAncHJvY2Vzcy10aWNrJykge1xuICAgICAgICAgICAgICAgIGV2LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICAgICAgICAgIGlmIChxdWV1ZS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBmbiA9IHF1ZXVlLnNoaWZ0KCk7XG4gICAgICAgICAgICAgICAgICAgIGZuKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9LCB0cnVlKTtcblxuICAgICAgICByZXR1cm4gZnVuY3Rpb24gbmV4dFRpY2soZm4pIHtcbiAgICAgICAgICAgIHF1ZXVlLnB1c2goZm4pO1xuICAgICAgICAgICAgd2luZG93LnBvc3RNZXNzYWdlKCdwcm9jZXNzLXRpY2snLCAnKicpO1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIHJldHVybiBmdW5jdGlvbiBuZXh0VGljayhmbikge1xuICAgICAgICBzZXRUaW1lb3V0KGZuLCAwKTtcbiAgICB9O1xufSkoKTtcblxucHJvY2Vzcy50aXRsZSA9ICdicm93c2VyJztcbnByb2Nlc3MuYnJvd3NlciA9IHRydWU7XG5wcm9jZXNzLmVudiA9IHt9O1xucHJvY2Vzcy5hcmd2ID0gW107XG5cbmZ1bmN0aW9uIG5vb3AoKSB7fVxuXG5wcm9jZXNzLm9uID0gbm9vcDtcbnByb2Nlc3MuYWRkTGlzdGVuZXIgPSBub29wO1xucHJvY2Vzcy5vbmNlID0gbm9vcDtcbnByb2Nlc3Mub2ZmID0gbm9vcDtcbnByb2Nlc3MucmVtb3ZlTGlzdGVuZXIgPSBub29wO1xucHJvY2Vzcy5yZW1vdmVBbGxMaXN0ZW5lcnMgPSBub29wO1xucHJvY2Vzcy5lbWl0ID0gbm9vcDtcblxucHJvY2Vzcy5iaW5kaW5nID0gZnVuY3Rpb24gKG5hbWUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuYmluZGluZyBpcyBub3Qgc3VwcG9ydGVkJyk7XG59XG5cbi8vIFRPRE8oc2h0eWxtYW4pXG5wcm9jZXNzLmN3ZCA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuICcvJyB9O1xucHJvY2Vzcy5jaGRpciA9IGZ1bmN0aW9uIChkaXIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuY2hkaXIgaXMgbm90IHN1cHBvcnRlZCcpO1xufTtcblxufSkuY2FsbCh0aGlzLHJlcXVpcmUoXCJvTWZwQW5cIiksdHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIgPyBzZWxmIDogdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHt9LHJlcXVpcmUoXCJidWZmZXJcIikuQnVmZmVyLGFyZ3VtZW50c1szXSxhcmd1bWVudHNbNF0sYXJndW1lbnRzWzVdLGFyZ3VtZW50c1s2XSxcIi8uLi8uLi9ub2RlX21vZHVsZXMvZ3VscC1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9wcm9jZXNzL2Jyb3dzZXIuanNcIixcIi8uLi8uLi9ub2RlX21vZHVsZXMvZ3VscC1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9wcm9jZXNzXCIpIiwiKGZ1bmN0aW9uIChwcm9jZXNzLGdsb2JhbCxCdWZmZXIsX19hcmd1bWVudDAsX19hcmd1bWVudDEsX19hcmd1bWVudDIsX19hcmd1bWVudDMsX19maWxlbmFtZSxfX2Rpcm5hbWUpe1xuLyohXHJcbiAqIE9iamVjdC5vYnNlcnZlIHBvbHlmaWxsIC0gdjAuMi40XHJcbiAqIGJ5IE1hc3NpbW8gQXJ0aXp6dSAoTWF4QXJ0MjUwMSlcclxuICogXHJcbiAqIGh0dHBzOi8vZ2l0aHViLmNvbS9NYXhBcnQyNTAxL29iamVjdC1vYnNlcnZlXHJcbiAqIFxyXG4gKiBMaWNlbnNlZCB1bmRlciB0aGUgTUlUIExpY2Vuc2VcclxuICogU2VlIExJQ0VOU0UgZm9yIGRldGFpbHNcclxuICovXHJcblxyXG4vLyBTb21lIHR5cGUgZGVmaW5pdGlvbnNcclxuLyoqXHJcbiAqIFRoaXMgcmVwcmVzZW50cyB0aGUgZGF0YSByZWxhdGl2ZSB0byBhbiBvYnNlcnZlZCBvYmplY3RcclxuICogQHR5cGVkZWYgIHtPYmplY3R9ICAgICAgICAgICAgICAgICAgICAgT2JqZWN0RGF0YVxyXG4gKiBAcHJvcGVydHkge01hcDxIYW5kbGVyLCBIYW5kbGVyRGF0YT59ICBoYW5kbGVyc1xyXG4gKiBAcHJvcGVydHkge1N0cmluZ1tdfSAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzXHJcbiAqIEBwcm9wZXJ0eSB7KltdfSAgICAgICAgICAgICAgICAgICAgICAgIHZhbHVlc1xyXG4gKiBAcHJvcGVydHkge0Rlc2NyaXB0b3JbXX0gICAgICAgICAgICAgICBkZXNjcmlwdG9yc1xyXG4gKiBAcHJvcGVydHkge05vdGlmaWVyfSAgICAgICAgICAgICAgICAgICBub3RpZmllclxyXG4gKiBAcHJvcGVydHkge0Jvb2xlYW59ICAgICAgICAgICAgICAgICAgICBmcm96ZW5cclxuICogQHByb3BlcnR5IHtCb29sZWFufSAgICAgICAgICAgICAgICAgICAgZXh0ZW5zaWJsZVxyXG4gKiBAcHJvcGVydHkge09iamVjdH0gICAgICAgICAgICAgICAgICAgICBwcm90b1xyXG4gKi9cclxuLyoqXHJcbiAqIEZ1bmN0aW9uIGRlZmluaXRpb24gb2YgYSBoYW5kbGVyXHJcbiAqIEBjYWxsYmFjayBIYW5kbGVyXHJcbiAqIEBwYXJhbSB7Q2hhbmdlUmVjb3JkW119ICAgICAgICAgICAgICAgIGNoYW5nZXNcclxuKi9cclxuLyoqXHJcbiAqIFRoaXMgcmVwcmVzZW50cyB0aGUgZGF0YSByZWxhdGl2ZSB0byBhbiBvYnNlcnZlZCBvYmplY3QgYW5kIG9uZSBvZiBpdHNcclxuICogaGFuZGxlcnNcclxuICogQHR5cGVkZWYgIHtPYmplY3R9ICAgICAgICAgICAgICAgICAgICAgSGFuZGxlckRhdGFcclxuICogQHByb3BlcnR5IHtNYXA8T2JqZWN0LCBPYnNlcnZlZERhdGE+fSAgb2JzZXJ2ZWRcclxuICogQHByb3BlcnR5IHtDaGFuZ2VSZWNvcmRbXX0gICAgICAgICAgICAgY2hhbmdlUmVjb3Jkc1xyXG4gKi9cclxuLyoqXHJcbiAqIEB0eXBlZGVmICB7T2JqZWN0fSAgICAgICAgICAgICAgICAgICAgIE9ic2VydmVkRGF0YVxyXG4gKiBAcHJvcGVydHkge1N0cmluZ1tdfSAgICAgICAgICAgICAgICAgICBhY2NlcHRMaXN0XHJcbiAqIEBwcm9wZXJ0eSB7T2JqZWN0RGF0YX0gICAgICAgICAgICAgICAgIGRhdGFcclxuKi9cclxuLyoqXHJcbiAqIFR5cGUgZGVmaW5pdGlvbiBmb3IgYSBjaGFuZ2UuIEFueSBvdGhlciBwcm9wZXJ0eSBjYW4gYmUgYWRkZWQgdXNpbmdcclxuICogdGhlIG5vdGlmeSgpIG9yIHBlcmZvcm1DaGFuZ2UoKSBtZXRob2RzIG9mIHRoZSBub3RpZmllci5cclxuICogQHR5cGVkZWYgIHtPYmplY3R9ICAgICAgICAgICAgICAgICAgICAgQ2hhbmdlUmVjb3JkXHJcbiAqIEBwcm9wZXJ0eSB7U3RyaW5nfSAgICAgICAgICAgICAgICAgICAgIHR5cGVcclxuICogQHByb3BlcnR5IHtPYmplY3R9ICAgICAgICAgICAgICAgICAgICAgb2JqZWN0XHJcbiAqIEBwcm9wZXJ0eSB7U3RyaW5nfSAgICAgICAgICAgICAgICAgICAgIFtuYW1lXVxyXG4gKiBAcHJvcGVydHkgeyp9ICAgICAgICAgICAgICAgICAgICAgICAgICBbb2xkVmFsdWVdXHJcbiAqIEBwcm9wZXJ0eSB7TnVtYmVyfSAgICAgICAgICAgICAgICAgICAgIFtpbmRleF1cclxuICovXHJcbi8qKlxyXG4gKiBUeXBlIGRlZmluaXRpb24gZm9yIGEgbm90aWZpZXIgKHdoYXQgT2JqZWN0LmdldE5vdGlmaWVyIHJldHVybnMpXHJcbiAqIEB0eXBlZGVmICB7T2JqZWN0fSAgICAgICAgICAgICAgICAgICAgIE5vdGlmaWVyXHJcbiAqIEBwcm9wZXJ0eSB7RnVuY3Rpb259ICAgICAgICAgICAgICAgICAgIG5vdGlmeVxyXG4gKiBAcHJvcGVydHkge0Z1bmN0aW9ufSAgICAgICAgICAgICAgICAgICBwZXJmb3JtQ2hhbmdlXHJcbiAqL1xyXG4vKipcclxuICogRnVuY3Rpb24gY2FsbGVkIHdpdGggTm90aWZpZXIucGVyZm9ybUNoYW5nZS4gSXQgbWF5IG9wdGlvbmFsbHkgcmV0dXJuIGFcclxuICogQ2hhbmdlUmVjb3JkIHRoYXQgZ2V0cyBhdXRvbWF0aWNhbGx5IG5vdGlmaWVkLCBidXQgYHR5cGVgIGFuZCBgb2JqZWN0YFxyXG4gKiBwcm9wZXJ0aWVzIGFyZSBvdmVycmlkZGVuLlxyXG4gKiBAY2FsbGJhY2sgUGVyZm9ybWVyXHJcbiAqIEByZXR1cm5zIHtDaGFuZ2VSZWNvcmR8dW5kZWZpbmVkfVxyXG4gKi9cclxuXHJcbk9iamVjdC5vYnNlcnZlIHx8IChmdW5jdGlvbihPLCBBLCByb290KSB7XHJcbiAgICBcInVzZSBzdHJpY3RcIjtcclxuXHJcbiAgICAgICAgLyoqXHJcbiAgICAgICAgICogUmVsYXRlcyBvYnNlcnZlZCBvYmplY3RzIGFuZCB0aGVpciBkYXRhXHJcbiAgICAgICAgICogQHR5cGUge01hcDxPYmplY3QsIE9iamVjdERhdGF9XHJcbiAgICAgICAgICovXHJcbiAgICB2YXIgb2JzZXJ2ZWQsXHJcbiAgICAgICAgLyoqXHJcbiAgICAgICAgICogTGlzdCBvZiBoYW5kbGVycyBhbmQgdGhlaXIgZGF0YVxyXG4gICAgICAgICAqIEB0eXBlIHtNYXA8SGFuZGxlciwgTWFwPE9iamVjdCwgSGFuZGxlckRhdGE+Pn1cclxuICAgICAgICAgKi9cclxuICAgICAgICBoYW5kbGVycyxcclxuXHJcbiAgICAgICAgZGVmYXVsdEFjY2VwdExpc3QgPSBbIFwiYWRkXCIsIFwidXBkYXRlXCIsIFwiZGVsZXRlXCIsIFwicmVjb25maWd1cmVcIiwgXCJzZXRQcm90b3R5cGVcIiwgXCJwcmV2ZW50RXh0ZW5zaW9uc1wiIF07XHJcblxyXG4gICAgLy8gRnVuY3Rpb25zIGZvciBpbnRlcm5hbCB1c2FnZVxyXG5cclxuICAgICAgICAvKipcclxuICAgICAgICAgKiBDaGVja3MgaWYgdGhlIGFyZ3VtZW50IGlzIGFuIEFycmF5IG9iamVjdC4gUG9seWZpbGxzIEFycmF5LmlzQXJyYXkuXHJcbiAgICAgICAgICogQGZ1bmN0aW9uIGlzQXJyYXlcclxuICAgICAgICAgKiBAcGFyYW0gez8qfSBvYmplY3RcclxuICAgICAgICAgKiBAcmV0dXJucyB7Qm9vbGVhbn1cclxuICAgICAgICAgKi9cclxuICAgIHZhciBpc0FycmF5ID0gQS5pc0FycmF5IHx8IChmdW5jdGlvbih0b1N0cmluZykge1xyXG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKG9iamVjdCkgeyByZXR1cm4gdG9TdHJpbmcuY2FsbChvYmplY3QpID09PSBcIltvYmplY3QgQXJyYXldXCI7IH07XHJcbiAgICAgICAgfSkoTy5wcm90b3R5cGUudG9TdHJpbmcpLFxyXG5cclxuICAgICAgICAvKipcclxuICAgICAgICAgKiBSZXR1cm5zIHRoZSBpbmRleCBvZiBhbiBpdGVtIGluIGEgY29sbGVjdGlvbiwgb3IgLTEgaWYgbm90IGZvdW5kLlxyXG4gICAgICAgICAqIFVzZXMgdGhlIGdlbmVyaWMgQXJyYXkuaW5kZXhPZiBvciBBcnJheS5wcm90b3R5cGUuaW5kZXhPZiBpZiBhdmFpbGFibGUuXHJcbiAgICAgICAgICogQGZ1bmN0aW9uIGluQXJyYXlcclxuICAgICAgICAgKiBAcGFyYW0ge0FycmF5fSBhcnJheVxyXG4gICAgICAgICAqIEBwYXJhbSB7Kn0gcGl2b3QgICAgICAgICAgIEl0ZW0gdG8gbG9vayBmb3JcclxuICAgICAgICAgKiBAcGFyYW0ge051bWJlcn0gW3N0YXJ0PTBdICBJbmRleCB0byBzdGFydCBmcm9tXHJcbiAgICAgICAgICogQHJldHVybnMge051bWJlcn1cclxuICAgICAgICAgKi9cclxuICAgICAgICBpbkFycmF5ID0gQS5wcm90b3R5cGUuaW5kZXhPZiA/IEEuaW5kZXhPZiB8fCBmdW5jdGlvbihhcnJheSwgcGl2b3QsIHN0YXJ0KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBBLnByb3RvdHlwZS5pbmRleE9mLmNhbGwoYXJyYXksIHBpdm90LCBzdGFydCk7XHJcbiAgICAgICAgfSA6IGZ1bmN0aW9uKGFycmF5LCBwaXZvdCwgc3RhcnQpIHtcclxuICAgICAgICAgICAgZm9yICh2YXIgaSA9IHN0YXJ0IHx8IDA7IGkgPCBhcnJheS5sZW5ndGg7IGkrKylcclxuICAgICAgICAgICAgICAgIGlmIChhcnJheVtpXSA9PT0gcGl2b3QpXHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGk7XHJcbiAgICAgICAgICAgIHJldHVybiAtMTtcclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICAvKipcclxuICAgICAgICAgKiBSZXR1cm5zIGFuIGluc3RhbmNlIG9mIE1hcCwgb3IgYSBNYXAtbGlrZSBvYmplY3QgaXMgTWFwIGlzIG5vdFxyXG4gICAgICAgICAqIHN1cHBvcnRlZCBvciBkb2Vzbid0IHN1cHBvcnQgZm9yRWFjaCgpXHJcbiAgICAgICAgICogQGZ1bmN0aW9uIGNyZWF0ZU1hcFxyXG4gICAgICAgICAqIEByZXR1cm5zIHtNYXB9XHJcbiAgICAgICAgICovXHJcbiAgICAgICAgY3JlYXRlTWFwID0gdHlwZW9mIHJvb3QuTWFwID09PSBcInVuZGVmaW5lZFwiIHx8ICFNYXAucHJvdG90eXBlLmZvckVhY2ggPyBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgLy8gTGlnaHR3ZWlnaHQgc2hpbSBvZiBNYXAuIExhY2tzIGNsZWFyKCksIGVudHJpZXMoKSwga2V5cygpIGFuZFxyXG4gICAgICAgICAgICAvLyB2YWx1ZXMoKSAodGhlIGxhc3QgMyBub3Qgc3VwcG9ydGVkIGJ5IElFMTEsIHNvIGNhbid0IHVzZSB0aGVtKSxcclxuICAgICAgICAgICAgLy8gaXQgZG9lc24ndCBoYW5kbGUgdGhlIGNvbnN0cnVjdG9yJ3MgYXJndW1lbnQgKGxpa2UgSUUxMSkgYW5kIG9mXHJcbiAgICAgICAgICAgIC8vIGNvdXJzZSBpdCBkb2Vzbid0IHN1cHBvcnQgZm9yLi4ub2YuXHJcbiAgICAgICAgICAgIC8vIENocm9tZSAzMS0zNSBhbmQgRmlyZWZveCAxMy0yNCBoYXZlIGEgYmFzaWMgc3VwcG9ydCBvZiBNYXAsIGJ1dFxyXG4gICAgICAgICAgICAvLyB0aGV5IGxhY2sgZm9yRWFjaCgpLCBzbyB0aGVpciBuYXRpdmUgaW1wbGVtZW50YXRpb24gaXMgYmFkIGZvclxyXG4gICAgICAgICAgICAvLyB0aGlzIHBvbHlmaWxsLiAoQ2hyb21lIDM2KyBzdXBwb3J0cyBPYmplY3Qub2JzZXJ2ZS4pXHJcbiAgICAgICAgICAgIHZhciBrZXlzID0gW10sIHZhbHVlcyA9IFtdO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgIHNpemU6IDAsXHJcbiAgICAgICAgICAgICAgICBoYXM6IGZ1bmN0aW9uKGtleSkgeyByZXR1cm4gaW5BcnJheShrZXlzLCBrZXkpID4gLTE7IH0sXHJcbiAgICAgICAgICAgICAgICBnZXQ6IGZ1bmN0aW9uKGtleSkgeyByZXR1cm4gdmFsdWVzW2luQXJyYXkoa2V5cywga2V5KV07IH0sXHJcbiAgICAgICAgICAgICAgICBzZXQ6IGZ1bmN0aW9uKGtleSwgdmFsdWUpIHtcclxuICAgICAgICAgICAgICAgICAgICB2YXIgaSA9IGluQXJyYXkoa2V5cywga2V5KTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoaSA9PT0gLTEpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAga2V5cy5wdXNoKGtleSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbHVlcy5wdXNoKHZhbHVlKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5zaXplKys7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHZhbHVlc1tpXSA9IHZhbHVlO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIFwiZGVsZXRlXCI6IGZ1bmN0aW9uKGtleSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHZhciBpID0gaW5BcnJheShrZXlzLCBrZXkpO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChpID4gLTEpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAga2V5cy5zcGxpY2UoaSwgMSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbHVlcy5zcGxpY2UoaSwgMSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuc2l6ZS0tO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICBmb3JFYWNoOiBmdW5jdGlvbihjYWxsYmFjay8qLCB0aGlzT2JqKi8pIHtcclxuICAgICAgICAgICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGtleXMubGVuZ3RoOyBpKyspXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNhbGxiYWNrLmNhbGwoYXJndW1lbnRzWzFdLCB2YWx1ZXNbaV0sIGtleXNbaV0sIHRoaXMpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgIH0gOiBmdW5jdGlvbigpIHsgcmV0dXJuIG5ldyBNYXAoKTsgfSxcclxuXHJcbiAgICAgICAgLyoqXHJcbiAgICAgICAgICogU2ltcGxlIHNoaW0gZm9yIE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzIHdoZW4gaXMgbm90IGF2YWlsYWJsZVxyXG4gICAgICAgICAqIE1pc3NlcyBjaGVja3Mgb24gb2JqZWN0LCBkb24ndCB1c2UgYXMgYSByZXBsYWNlbWVudCBvZiBPYmplY3Qua2V5cy9nZXRPd25Qcm9wZXJ0eU5hbWVzXHJcbiAgICAgICAgICogQGZ1bmN0aW9uIGdldFByb3BzXHJcbiAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IG9iamVjdFxyXG4gICAgICAgICAqIEByZXR1cm5zIHtTdHJpbmdbXX1cclxuICAgICAgICAgKi9cclxuICAgICAgICBnZXRQcm9wcyA9IE8uZ2V0T3duUHJvcGVydHlOYW1lcyA/IChmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgdmFyIGZ1bmMgPSBPLmdldE93blByb3BlcnR5TmFtZXM7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBhcmd1bWVudHMuY2FsbGVlO1xyXG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBTdHJpY3QgbW9kZSBpcyBzdXBwb3J0ZWRcclxuXHJcbiAgICAgICAgICAgICAgICAvLyBJbiBzdHJpY3QgbW9kZSwgd2UgY2FuJ3QgYWNjZXNzIHRvIFwiYXJndW1lbnRzXCIsIFwiY2FsbGVyXCIgYW5kXHJcbiAgICAgICAgICAgICAgICAvLyBcImNhbGxlZVwiIHByb3BlcnRpZXMgb2YgZnVuY3Rpb25zLiBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lc1xyXG4gICAgICAgICAgICAgICAgLy8gcmV0dXJucyBbIFwicHJvdG90eXBlXCIsIFwibGVuZ3RoXCIsIFwibmFtZVwiIF0gaW4gRmlyZWZveDsgaXQgcmV0dXJuc1xyXG4gICAgICAgICAgICAgICAgLy8gXCJjYWxsZXJcIiBhbmQgXCJhcmd1bWVudHNcIiB0b28gaW4gQ2hyb21lIGFuZCBpbiBJbnRlcm5ldFxyXG4gICAgICAgICAgICAgICAgLy8gRXhwbG9yZXIsIHNvIHRob3NlIHZhbHVlcyBtdXN0IGJlIGZpbHRlcmVkLlxyXG4gICAgICAgICAgICAgICAgdmFyIGF2b2lkID0gKGZ1bmMoaW5BcnJheSkuam9pbihcIiBcIikgKyBcIiBcIikucmVwbGFjZSgvcHJvdG90eXBlIHxsZW5ndGggfG5hbWUgL2csIFwiXCIpLnNsaWNlKDAsIC0xKS5zcGxpdChcIiBcIik7XHJcbiAgICAgICAgICAgICAgICBpZiAoYXZvaWQubGVuZ3RoKSBmdW5jID0gZnVuY3Rpb24ob2JqZWN0KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIHByb3BzID0gTy5nZXRPd25Qcm9wZXJ0eU5hbWVzKG9iamVjdCk7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBvYmplY3QgPT09IFwiZnVuY3Rpb25cIilcclxuICAgICAgICAgICAgICAgICAgICAgICAgZm9yICh2YXIgaSA9IDAsIGo7IGkgPCBhdm9pZC5sZW5ndGg7KVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKChqID0gaW5BcnJheShwcm9wcywgYXZvaWRbaSsrXSkpID4gLTEpXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJvcHMuc3BsaWNlKGosIDEpO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gcHJvcHM7XHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHJldHVybiBmdW5jO1xyXG4gICAgICAgIH0pKCkgOiBmdW5jdGlvbihvYmplY3QpIHtcclxuICAgICAgICAgICAgLy8gUG9vci1tb3V0aCB2ZXJzaW9uIHdpdGggZm9yLi4uaW4gKElFOC0pXHJcbiAgICAgICAgICAgIHZhciBwcm9wcyA9IFtdLCBwcm9wLCBob3A7XHJcbiAgICAgICAgICAgIGlmIChcImhhc093blByb3BlcnR5XCIgaW4gb2JqZWN0KSB7XHJcbiAgICAgICAgICAgICAgICBmb3IgKHByb3AgaW4gb2JqZWN0KVxyXG4gICAgICAgICAgICAgICAgICAgIGlmIChvYmplY3QuaGFzT3duUHJvcGVydHkocHJvcCkpXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHByb3BzLnB1c2gocHJvcCk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBob3AgPSBPLmhhc093blByb3BlcnR5O1xyXG4gICAgICAgICAgICAgICAgZm9yIChwcm9wIGluIG9iamVjdClcclxuICAgICAgICAgICAgICAgICAgICBpZiAoaG9wLmNhbGwob2JqZWN0LCBwcm9wKSlcclxuICAgICAgICAgICAgICAgICAgICAgICAgcHJvcHMucHVzaChwcm9wKTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLy8gSW5zZXJ0aW5nIGEgY29tbW9uIG5vbi1lbnVtZXJhYmxlIHByb3BlcnR5IG9mIGFycmF5c1xyXG4gICAgICAgICAgICBpZiAoaXNBcnJheShvYmplY3QpKVxyXG4gICAgICAgICAgICAgICAgcHJvcHMucHVzaChcImxlbmd0aFwiKTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiBwcm9wcztcclxuICAgICAgICB9LFxyXG5cclxuICAgICAgICAvKipcclxuICAgICAgICAgKiBSZXR1cm4gdGhlIHByb3RvdHlwZSBvZiB0aGUgb2JqZWN0Li4uIGlmIGRlZmluZWQuXHJcbiAgICAgICAgICogQGZ1bmN0aW9uIGdldFByb3RvdHlwZVxyXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3RcclxuICAgICAgICAgKiBAcmV0dXJucyB7T2JqZWN0fVxyXG4gICAgICAgICAqL1xyXG4gICAgICAgIGdldFByb3RvdHlwZSA9IE8uZ2V0UHJvdG90eXBlT2YsXHJcblxyXG4gICAgICAgIC8qKlxyXG4gICAgICAgICAqIFJldHVybiB0aGUgZGVzY3JpcHRvciBvZiB0aGUgb2JqZWN0Li4uIGlmIGRlZmluZWQuXHJcbiAgICAgICAgICogSUU4IHN1cHBvcnRzIGEgKHVzZWxlc3MpIE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IgZm9yIERPTVxyXG4gICAgICAgICAqIG5vZGVzIG9ubHksIHNvIGRlZmluZVByb3BlcnRpZXMgaXMgY2hlY2tlZCBpbnN0ZWFkLlxyXG4gICAgICAgICAqIEBmdW5jdGlvbiBnZXREZXNjcmlwdG9yXHJcbiAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IG9iamVjdFxyXG4gICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBwcm9wZXJ0eVxyXG4gICAgICAgICAqIEByZXR1cm5zIHtEZXNjcmlwdG9yfVxyXG4gICAgICAgICAqL1xyXG4gICAgICAgIGdldERlc2NyaXB0b3IgPSBPLmRlZmluZVByb3BlcnRpZXMgJiYgTy5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IsXHJcblxyXG4gICAgICAgIC8qKlxyXG4gICAgICAgICAqIFNldHMgdXAgdGhlIG5leHQgY2hlY2sgYW5kIGRlbGl2ZXJpbmcgaXRlcmF0aW9uLCB1c2luZ1xyXG4gICAgICAgICAqIHJlcXVlc3RBbmltYXRpb25GcmFtZSBvciBhIChjbG9zZSkgcG9seWZpbGwuXHJcbiAgICAgICAgICogQGZ1bmN0aW9uIG5leHRGcmFtZVxyXG4gICAgICAgICAqIEBwYXJhbSB7ZnVuY3Rpb259IGZ1bmNcclxuICAgICAgICAgKiBAcmV0dXJucyB7bnVtYmVyfVxyXG4gICAgICAgICAqL1xyXG4gICAgICAgIG5leHRGcmFtZSA9IHJvb3QucmVxdWVzdEFuaW1hdGlvbkZyYW1lIHx8IHJvb3Qud2Via2l0UmVxdWVzdEFuaW1hdGlvbkZyYW1lIHx8IChmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgdmFyIGluaXRpYWwgPSArbmV3IERhdGUsXHJcbiAgICAgICAgICAgICAgICBsYXN0ID0gaW5pdGlhbDtcclxuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uKGZ1bmMpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGZ1bmMoKGxhc3QgPSArbmV3IERhdGUpIC0gaW5pdGlhbCk7XHJcbiAgICAgICAgICAgICAgICB9LCAxNyk7XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfSkoKSxcclxuXHJcbiAgICAgICAgLyoqXHJcbiAgICAgICAgICogU2V0cyB1cCB0aGUgb2JzZXJ2YXRpb24gb2YgYW4gb2JqZWN0XHJcbiAgICAgICAgICogQGZ1bmN0aW9uIGRvT2JzZXJ2ZVxyXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3RcclxuICAgICAgICAgKiBAcGFyYW0ge0hhbmRsZXJ9IGhhbmRsZXJcclxuICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ1tdfSBbYWNjZXB0TGlzdF1cclxuICAgICAgICAgKi9cclxuICAgICAgICBkb09ic2VydmUgPSBmdW5jdGlvbihvYmplY3QsIGhhbmRsZXIsIGFjY2VwdExpc3QpIHtcclxuXHJcbiAgICAgICAgICAgIHZhciBkYXRhID0gb2JzZXJ2ZWQuZ2V0KG9iamVjdCk7XHJcblxyXG4gICAgICAgICAgICBpZiAoZGF0YSlcclxuICAgICAgICAgICAgICAgIHNldEhhbmRsZXIob2JqZWN0LCBkYXRhLCBoYW5kbGVyLCBhY2NlcHRMaXN0KTtcclxuICAgICAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBkYXRhID0gY3JlYXRlT2JqZWN0RGF0YShvYmplY3QpO1xyXG4gICAgICAgICAgICAgICAgc2V0SGFuZGxlcihvYmplY3QsIGRhdGEsIGhhbmRsZXIsIGFjY2VwdExpc3QpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAob2JzZXJ2ZWQuc2l6ZSA9PT0gMSlcclxuICAgICAgICAgICAgICAgICAgICAvLyBMZXQgdGhlIG9ic2VydmF0aW9uIGJlZ2luIVxyXG4gICAgICAgICAgICAgICAgICAgIG5leHRGcmFtZShydW5HbG9iYWxMb29wKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIC8qKlxyXG4gICAgICAgICAqIENyZWF0ZXMgdGhlIGluaXRpYWwgZGF0YSBmb3IgYW4gb2JzZXJ2ZWQgb2JqZWN0XHJcbiAgICAgICAgICogQGZ1bmN0aW9uIGNyZWF0ZU9iamVjdERhdGFcclxuICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gb2JqZWN0XHJcbiAgICAgICAgICovXHJcbiAgICAgICAgY3JlYXRlT2JqZWN0RGF0YSA9IGZ1bmN0aW9uKG9iamVjdCwgZGF0YSkge1xyXG4gICAgICAgICAgICB2YXIgcHJvcHMgPSBnZXRQcm9wcyhvYmplY3QpLFxyXG4gICAgICAgICAgICAgICAgdmFsdWVzID0gW10sIGRlc2NzLCBpID0gMCxcclxuICAgICAgICAgICAgICAgIGRhdGEgPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaGFuZGxlcnM6IGNyZWF0ZU1hcCgpLFxyXG4gICAgICAgICAgICAgICAgICAgIGZyb3plbjogTy5pc0Zyb3plbiA/IE8uaXNGcm96ZW4ob2JqZWN0KSA6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgIGV4dGVuc2libGU6IE8uaXNFeHRlbnNpYmxlID8gTy5pc0V4dGVuc2libGUob2JqZWN0KSA6IHRydWUsXHJcbiAgICAgICAgICAgICAgICAgICAgcHJvdG86IGdldFByb3RvdHlwZSAmJiBnZXRQcm90b3R5cGUob2JqZWN0KSxcclxuICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiBwcm9wcyxcclxuICAgICAgICAgICAgICAgICAgICB2YWx1ZXM6IHZhbHVlcyxcclxuICAgICAgICAgICAgICAgICAgICBub3RpZmllcjogcmV0cmlldmVOb3RpZmllcihvYmplY3QsIGRhdGEpXHJcbiAgICAgICAgICAgICAgICB9O1xyXG5cclxuICAgICAgICAgICAgaWYgKGdldERlc2NyaXB0b3IpIHtcclxuICAgICAgICAgICAgICAgIGRlc2NzID0gZGF0YS5kZXNjcmlwdG9ycyA9IFtdO1xyXG4gICAgICAgICAgICAgICAgd2hpbGUgKGkgPCBwcm9wcy5sZW5ndGgpIHtcclxuICAgICAgICAgICAgICAgICAgICBkZXNjc1tpXSA9IGdldERlc2NyaXB0b3Iob2JqZWN0LCBwcm9wc1tpXSk7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFsdWVzW2ldID0gb2JqZWN0W3Byb3BzW2krK11dO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9IGVsc2Ugd2hpbGUgKGkgPCBwcm9wcy5sZW5ndGgpXHJcbiAgICAgICAgICAgICAgICB2YWx1ZXNbaV0gPSBvYmplY3RbcHJvcHNbaSsrXV07XHJcblxyXG4gICAgICAgICAgICBvYnNlcnZlZC5zZXQob2JqZWN0LCBkYXRhKTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiBkYXRhO1xyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIC8qKlxyXG4gICAgICAgICAqIFBlcmZvcm1zIGJhc2ljIHByb3BlcnR5IHZhbHVlIGNoYW5nZSBjaGVja3Mgb24gYW4gb2JzZXJ2ZWQgb2JqZWN0XHJcbiAgICAgICAgICogQGZ1bmN0aW9uIHBlcmZvcm1Qcm9wZXJ0eUNoZWNrc1xyXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0RGF0YX0gZGF0YVxyXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3RcclxuICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gW2V4Y2VwdF0gIERvZXNuJ3QgZGVsaXZlciB0aGUgY2hhbmdlcyB0byB0aGVcclxuICAgICAgICAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhbmRsZXJzIHRoYXQgYWNjZXB0IHRoaXMgdHlwZVxyXG4gICAgICAgICAqL1xyXG4gICAgICAgIHBlcmZvcm1Qcm9wZXJ0eUNoZWNrcyA9IChmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgdmFyIHVwZGF0ZUNoZWNrID0gZ2V0RGVzY3JpcHRvciA/IGZ1bmN0aW9uKG9iamVjdCwgZGF0YSwgaWR4LCBleGNlcHQsIGRlc2NyKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIga2V5ID0gZGF0YS5wcm9wZXJ0aWVzW2lkeF0sXHJcbiAgICAgICAgICAgICAgICAgICAgdmFsdWUgPSBvYmplY3Rba2V5XSxcclxuICAgICAgICAgICAgICAgICAgICBvdmFsdWUgPSBkYXRhLnZhbHVlc1tpZHhdLFxyXG4gICAgICAgICAgICAgICAgICAgIG9kZXNjID0gZGF0YS5kZXNjcmlwdG9yc1tpZHhdO1xyXG5cclxuICAgICAgICAgICAgICAgIGlmIChcInZhbHVlXCIgaW4gZGVzY3IgJiYgKG92YWx1ZSA9PT0gdmFsdWVcclxuICAgICAgICAgICAgICAgICAgICAgICAgPyBvdmFsdWUgPT09IDAgJiYgMS9vdmFsdWUgIT09IDEvdmFsdWUgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIDogb3ZhbHVlID09PSBvdmFsdWUgfHwgdmFsdWUgPT09IHZhbHVlKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGFkZENoYW5nZVJlY29yZChvYmplY3QsIGRhdGEsIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZToga2V5LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiBcInVwZGF0ZVwiLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBvYmplY3Q6IG9iamVjdCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgb2xkVmFsdWU6IG92YWx1ZVxyXG4gICAgICAgICAgICAgICAgICAgIH0sIGV4Y2VwdCk7XHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YS52YWx1ZXNbaWR4XSA9IHZhbHVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaWYgKG9kZXNjLmNvbmZpZ3VyYWJsZSAmJiAoIWRlc2NyLmNvbmZpZ3VyYWJsZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB8fCBkZXNjci53cml0YWJsZSAhPT0gb2Rlc2Mud3JpdGFibGVcclxuICAgICAgICAgICAgICAgICAgICAgICAgfHwgZGVzY3IuZW51bWVyYWJsZSAhPT0gb2Rlc2MuZW51bWVyYWJsZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB8fCBkZXNjci5nZXQgIT09IG9kZXNjLmdldFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB8fCBkZXNjci5zZXQgIT09IG9kZXNjLnNldCkpIHtcclxuICAgICAgICAgICAgICAgICAgICBhZGRDaGFuZ2VSZWNvcmQob2JqZWN0LCBkYXRhLCB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IGtleSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJyZWNvbmZpZ3VyZVwiLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBvYmplY3Q6IG9iamVjdCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgb2xkVmFsdWU6IG92YWx1ZVxyXG4gICAgICAgICAgICAgICAgICAgIH0sIGV4Y2VwdCk7XHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YS5kZXNjcmlwdG9yc1tpZHhdID0gZGVzY3I7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0gOiBmdW5jdGlvbihvYmplY3QsIGRhdGEsIGlkeCwgZXhjZXB0KSB7XHJcbiAgICAgICAgICAgICAgICB2YXIga2V5ID0gZGF0YS5wcm9wZXJ0aWVzW2lkeF0sXHJcbiAgICAgICAgICAgICAgICAgICAgdmFsdWUgPSBvYmplY3Rba2V5XSxcclxuICAgICAgICAgICAgICAgICAgICBvdmFsdWUgPSBkYXRhLnZhbHVlc1tpZHhdO1xyXG5cclxuICAgICAgICAgICAgICAgIGlmIChvdmFsdWUgPT09IHZhbHVlID8gb3ZhbHVlID09PSAwICYmIDEvb3ZhbHVlICE9PSAxL3ZhbHVlIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICA6IG92YWx1ZSA9PT0gb3ZhbHVlIHx8IHZhbHVlID09PSB2YWx1ZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGFkZENoYW5nZVJlY29yZChvYmplY3QsIGRhdGEsIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZToga2V5LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiBcInVwZGF0ZVwiLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBvYmplY3Q6IG9iamVjdCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgb2xkVmFsdWU6IG92YWx1ZVxyXG4gICAgICAgICAgICAgICAgICAgIH0sIGV4Y2VwdCk7XHJcbiAgICAgICAgICAgICAgICAgICAgZGF0YS52YWx1ZXNbaWR4XSA9IHZhbHVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9O1xyXG5cclxuICAgICAgICAgICAgLy8gQ2hlY2tzIGlmIHNvbWUgcHJvcGVydHkgaGFzIGJlZW4gZGVsZXRlZFxyXG4gICAgICAgICAgICB2YXIgZGVsZXRpb25DaGVjayA9IGdldERlc2NyaXB0b3IgPyBmdW5jdGlvbihvYmplY3QsIHByb3BzLCBwcm9wbGVuLCBkYXRhLCBleGNlcHQpIHtcclxuICAgICAgICAgICAgICAgIHZhciBpID0gcHJvcHMubGVuZ3RoLCBkZXNjcjtcclxuICAgICAgICAgICAgICAgIHdoaWxlIChwcm9wbGVuICYmIGktLSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChwcm9wc1tpXSAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBkZXNjciA9IGdldERlc2NyaXB0b3Iob2JqZWN0LCBwcm9wc1tpXSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHByb3BsZW4tLTtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIElmIHRoZXJlJ3Mgbm8gZGVzY3JpcHRvciwgdGhlIHByb3BlcnR5IGhhcyByZWFsbHlcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gYmVlbiBkZWxldGVkOyBvdGhlcndpc2UsIGl0J3MgYmVlbiByZWNvbmZpZ3VyZWQgc29cclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gdGhhdCdzIG5vdCBlbnVtZXJhYmxlIGFueW1vcmVcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGRlc2NyKSB1cGRhdGVDaGVjayhvYmplY3QsIGRhdGEsIGksIGV4Y2VwdCwgZGVzY3IpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFkZENoYW5nZVJlY29yZChvYmplY3QsIGRhdGEsIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBwcm9wc1tpXSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiBcImRlbGV0ZVwiLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9iamVjdDogb2JqZWN0LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9sZFZhbHVlOiBkYXRhLnZhbHVlc1tpXVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSwgZXhjZXB0KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRhdGEucHJvcGVydGllcy5zcGxpY2UoaSwgMSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkYXRhLnZhbHVlcy5zcGxpY2UoaSwgMSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkYXRhLmRlc2NyaXB0b3JzLnNwbGljZShpLCAxKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSA6IGZ1bmN0aW9uKG9iamVjdCwgcHJvcHMsIHByb3BsZW4sIGRhdGEsIGV4Y2VwdCkge1xyXG4gICAgICAgICAgICAgICAgdmFyIGkgPSBwcm9wcy5sZW5ndGg7XHJcbiAgICAgICAgICAgICAgICB3aGlsZSAocHJvcGxlbiAmJiBpLS0pXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHByb3BzW2ldICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFkZENoYW5nZVJlY29yZChvYmplY3QsIGRhdGEsIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IHByb3BzW2ldLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJkZWxldGVcIixcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9iamVjdDogb2JqZWN0LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb2xkVmFsdWU6IGRhdGEudmFsdWVzW2ldXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sIGV4Y2VwdCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGRhdGEucHJvcGVydGllcy5zcGxpY2UoaSwgMSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGRhdGEudmFsdWVzLnNwbGljZShpLCAxKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcHJvcGxlbi0tO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbihkYXRhLCBvYmplY3QsIGV4Y2VwdCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFkYXRhLmhhbmRsZXJzLnNpemUgfHwgZGF0YS5mcm96ZW4pIHJldHVybjtcclxuXHJcbiAgICAgICAgICAgICAgICB2YXIgcHJvcHMsIHByb3BsZW4sIGtleXMsXHJcbiAgICAgICAgICAgICAgICAgICAgdmFsdWVzID0gZGF0YS52YWx1ZXMsXHJcbiAgICAgICAgICAgICAgICAgICAgZGVzY3MgPSBkYXRhLmRlc2NyaXB0b3JzLFxyXG4gICAgICAgICAgICAgICAgICAgIGkgPSAwLCBpZHgsXHJcbiAgICAgICAgICAgICAgICAgICAga2V5LCB2YWx1ZSxcclxuICAgICAgICAgICAgICAgICAgICBwcm90bywgZGVzY3I7XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gSWYgdGhlIG9iamVjdCBpc24ndCBleHRlbnNpYmxlLCB3ZSBkb24ndCBuZWVkIHRvIGNoZWNrIGZvciBuZXdcclxuICAgICAgICAgICAgICAgIC8vIG9yIGRlbGV0ZWQgcHJvcGVydGllc1xyXG4gICAgICAgICAgICAgICAgaWYgKGRhdGEuZXh0ZW5zaWJsZSkge1xyXG5cclxuICAgICAgICAgICAgICAgICAgICBwcm9wcyA9IGRhdGEucHJvcGVydGllcy5zbGljZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgIHByb3BsZW4gPSBwcm9wcy5sZW5ndGg7XHJcbiAgICAgICAgICAgICAgICAgICAga2V5cyA9IGdldFByb3BzKG9iamVjdCk7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIGlmIChkZXNjcykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB3aGlsZSAoaSA8IGtleXMubGVuZ3RoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBrZXkgPSBrZXlzW2krK107XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZHggPSBpbkFycmF5KHByb3BzLCBrZXkpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3IgPSBnZXREZXNjcmlwdG9yKG9iamVjdCwga2V5KTtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoaWR4ID09PSAtMSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFkZENoYW5nZVJlY29yZChvYmplY3QsIGRhdGEsIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbmFtZToga2V5LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiBcImFkZFwiLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvYmplY3Q6IG9iamVjdFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sIGV4Y2VwdCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZGF0YS5wcm9wZXJ0aWVzLnB1c2goa2V5KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZXMucHVzaChvYmplY3Rba2V5XSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3MucHVzaChkZXNjcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHByb3BzW2lkeF0gPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHByb3BsZW4tLTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB1cGRhdGVDaGVjayhvYmplY3QsIGRhdGEsIGlkeCwgZXhjZXB0LCBkZXNjcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRpb25DaGVjayhvYmplY3QsIHByb3BzLCBwcm9wbGVuLCBkYXRhLCBleGNlcHQpO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFPLmlzRXh0ZW5zaWJsZShvYmplY3QpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkYXRhLmV4dGVuc2libGUgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFkZENoYW5nZVJlY29yZChvYmplY3QsIGRhdGEsIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiBcInByZXZlbnRFeHRlbnNpb25zXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb2JqZWN0OiBvYmplY3RcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sIGV4Y2VwdCk7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGF0YS5mcm96ZW4gPSBPLmlzRnJvemVuKG9iamVjdCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB3aGlsZSAoaSA8IGtleXMubGVuZ3RoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBrZXkgPSBrZXlzW2krK107XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZHggPSBpbkFycmF5KHByb3BzLCBrZXkpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWUgPSBvYmplY3Rba2V5XTtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoaWR4ID09PSAtMSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFkZENoYW5nZVJlY29yZChvYmplY3QsIGRhdGEsIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbmFtZToga2V5LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiBcImFkZFwiLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvYmplY3Q6IG9iamVjdFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sIGV4Y2VwdCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZGF0YS5wcm9wZXJ0aWVzLnB1c2goa2V5KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZXMucHVzaCh2YWx1ZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHByb3BzW2lkeF0gPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHByb3BsZW4tLTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB1cGRhdGVDaGVjayhvYmplY3QsIGRhdGEsIGlkeCwgZXhjZXB0KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBkZWxldGlvbkNoZWNrKG9iamVjdCwgcHJvcHMsIHByb3BsZW4sIGRhdGEsIGV4Y2VwdCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoIWRhdGEuZnJvemVuKSB7XHJcblxyXG4gICAgICAgICAgICAgICAgICAgIC8vIElmIHRoZSBvYmplY3QgaXMgbm90IGV4dGVuc2libGUsIGJ1dCBub3QgZnJvemVuLCB3ZSBqdXN0IGhhdmVcclxuICAgICAgICAgICAgICAgICAgICAvLyB0byBjaGVjayBmb3IgdmFsdWUgY2hhbmdlc1xyXG4gICAgICAgICAgICAgICAgICAgIGZvciAoOyBpIDwgcHJvcHMubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAga2V5ID0gcHJvcHNbaV07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHVwZGF0ZUNoZWNrKG9iamVjdCwgZGF0YSwgaSwgZXhjZXB0LCBnZXREZXNjcmlwdG9yKG9iamVjdCwga2V5KSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAgICAgICBpZiAoTy5pc0Zyb3plbihvYmplY3QpKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBkYXRhLmZyb3plbiA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgaWYgKGdldFByb3RvdHlwZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHByb3RvID0gZ2V0UHJvdG90eXBlKG9iamVjdCk7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHByb3RvICE9PSBkYXRhLnByb3RvKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFkZENoYW5nZVJlY29yZChvYmplY3QsIGRhdGEsIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6IFwic2V0UHJvdG90eXBlXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBcIl9fcHJvdG9fX1wiLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb2JqZWN0OiBvYmplY3QsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbGRWYWx1ZTogZGF0YS5wcm90b1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZGF0YS5wcm90byA9IHByb3RvO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9KSgpLFxyXG5cclxuICAgICAgICAvKipcclxuICAgICAgICAgKiBTZXRzIHVwIHRoZSBtYWluIGxvb3AgZm9yIG9iamVjdCBvYnNlcnZhdGlvbiBhbmQgY2hhbmdlIG5vdGlmaWNhdGlvblxyXG4gICAgICAgICAqIEl0IHN0b3BzIGlmIG5vIG9iamVjdCBpcyBvYnNlcnZlZC5cclxuICAgICAgICAgKiBAZnVuY3Rpb24gcnVuR2xvYmFsTG9vcFxyXG4gICAgICAgICAqL1xyXG4gICAgICAgIHJ1bkdsb2JhbExvb3AgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgaWYgKG9ic2VydmVkLnNpemUpIHtcclxuICAgICAgICAgICAgICAgIG9ic2VydmVkLmZvckVhY2gocGVyZm9ybVByb3BlcnR5Q2hlY2tzKTtcclxuICAgICAgICAgICAgICAgIGhhbmRsZXJzLmZvckVhY2goZGVsaXZlckhhbmRsZXJSZWNvcmRzKTtcclxuICAgICAgICAgICAgICAgIG5leHRGcmFtZShydW5HbG9iYWxMb29wKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0sXHJcblxyXG4gICAgICAgIC8qKlxyXG4gICAgICAgICAqIERlbGl2ZXIgdGhlIGNoYW5nZSByZWNvcmRzIHJlbGF0aXZlIHRvIGEgY2VydGFpbiBoYW5kbGVyLCBhbmQgcmVzZXRzXHJcbiAgICAgICAgICogdGhlIHJlY29yZCBsaXN0LlxyXG4gICAgICAgICAqIEBwYXJhbSB7SGFuZGxlckRhdGF9IGhkYXRhXHJcbiAgICAgICAgICogQHBhcmFtIHtIYW5kbGVyfSBoYW5kbGVyXHJcbiAgICAgICAgICovXHJcbiAgICAgICAgZGVsaXZlckhhbmRsZXJSZWNvcmRzID0gZnVuY3Rpb24oaGRhdGEsIGhhbmRsZXIpIHtcclxuICAgICAgICAgICAgaWYgKGhkYXRhLmNoYW5nZVJlY29yZHMubGVuZ3RoKSB7XHJcbiAgICAgICAgICAgICAgICBoYW5kbGVyKGhkYXRhLmNoYW5nZVJlY29yZHMpO1xyXG4gICAgICAgICAgICAgICAgaGRhdGEuY2hhbmdlUmVjb3JkcyA9IFtdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgLyoqXHJcbiAgICAgICAgICogUmV0dXJucyB0aGUgbm90aWZpZXIgZm9yIGFuIG9iamVjdCAtIHdoZXRoZXIgaXQncyBvYnNlcnZlZCBvciBub3RcclxuICAgICAgICAgKiBAZnVuY3Rpb24gcmV0cmlldmVOb3RpZmllclxyXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3RcclxuICAgICAgICAgKiBAcGFyYW0ge09iamVjdERhdGF9IFtkYXRhXVxyXG4gICAgICAgICAqIEByZXR1cm5zIHtOb3RpZmllcn1cclxuICAgICAgICAgKi9cclxuICAgICAgICByZXRyaWV2ZU5vdGlmaWVyID0gZnVuY3Rpb24ob2JqZWN0LCBkYXRhKSB7XHJcbiAgICAgICAgICAgIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMilcclxuICAgICAgICAgICAgICAgIGRhdGEgPSBvYnNlcnZlZC5nZXQob2JqZWN0KTtcclxuXHJcbiAgICAgICAgICAgIC8qKiBAdHlwZSB7Tm90aWZpZXJ9ICovXHJcbiAgICAgICAgICAgIHJldHVybiBkYXRhICYmIGRhdGEubm90aWZpZXIgfHwge1xyXG4gICAgICAgICAgICAgICAgLyoqXHJcbiAgICAgICAgICAgICAgICAgKiBAbWV0aG9kIG5vdGlmeVxyXG4gICAgICAgICAgICAgICAgICogQHNlZSBodHRwOi8vYXJ2LmdpdGh1Yi5pby9lY21hc2NyaXB0LW9iamVjdC1vYnNlcnZlLyNub3RpZmllcnByb3RvdHlwZS5fbm90aWZ5XHJcbiAgICAgICAgICAgICAgICAgKiBAbWVtYmVyb2YgTm90aWZpZXJcclxuICAgICAgICAgICAgICAgICAqIEBwYXJhbSB7Q2hhbmdlUmVjb3JkfSBjaGFuZ2VSZWNvcmRcclxuICAgICAgICAgICAgICAgICAqL1xyXG4gICAgICAgICAgICAgICAgbm90aWZ5OiBmdW5jdGlvbihjaGFuZ2VSZWNvcmQpIHtcclxuICAgICAgICAgICAgICAgICAgICBjaGFuZ2VSZWNvcmQudHlwZTsgLy8gSnVzdCB0byBjaGVjayB0aGUgcHJvcGVydHkgaXMgdGhlcmUuLi5cclxuXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gSWYgdGhlcmUncyBubyBkYXRhLCB0aGUgb2JqZWN0IGhhcyBiZWVuIHVub2JzZXJ2ZWRcclxuICAgICAgICAgICAgICAgICAgICB2YXIgZGF0YSA9IG9ic2VydmVkLmdldChvYmplY3QpO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChkYXRhKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciByZWNvcmRDb3B5ID0geyBvYmplY3Q6IG9iamVjdCB9LCBwcm9wO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBmb3IgKHByb3AgaW4gY2hhbmdlUmVjb3JkKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHByb3AgIT09IFwib2JqZWN0XCIpXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVjb3JkQ29weVtwcm9wXSA9IGNoYW5nZVJlY29yZFtwcm9wXTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYWRkQ2hhbmdlUmVjb3JkKG9iamVjdCwgZGF0YSwgcmVjb3JkQ29weSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSxcclxuXHJcbiAgICAgICAgICAgICAgICAvKipcclxuICAgICAgICAgICAgICAgICAqIEBtZXRob2QgcGVyZm9ybUNoYW5nZVxyXG4gICAgICAgICAgICAgICAgICogQHNlZSBodHRwOi8vYXJ2LmdpdGh1Yi5pby9lY21hc2NyaXB0LW9iamVjdC1vYnNlcnZlLyNub3RpZmllcnByb3RvdHlwZV8ucGVyZm9ybWNoYW5nZVxyXG4gICAgICAgICAgICAgICAgICogQG1lbWJlcm9mIE5vdGlmaWVyXHJcbiAgICAgICAgICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gY2hhbmdlVHlwZVxyXG4gICAgICAgICAgICAgICAgICogQHBhcmFtIHtQZXJmb3JtZXJ9IGZ1bmMgICAgIFRoZSB0YXNrIHBlcmZvcm1lclxyXG4gICAgICAgICAgICAgICAgICogQHBhcmFtIHsqfSBbdGhpc09ial0gICAgICAgIFVzZWQgdG8gc2V0IGB0aGlzYCB3aGVuIGNhbGxpbmcgZnVuY1xyXG4gICAgICAgICAgICAgICAgICovXHJcbiAgICAgICAgICAgICAgICBwZXJmb3JtQ2hhbmdlOiBmdW5jdGlvbihjaGFuZ2VUeXBlLCBmdW5jLyosIHRoaXNPYmoqLykge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgY2hhbmdlVHlwZSAhPT0gXCJzdHJpbmdcIilcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkludmFsaWQgbm9uLXN0cmluZyBjaGFuZ2VUeXBlXCIpO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGZ1bmMgIT09IFwiZnVuY3Rpb25cIilcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkNhbm5vdCBwZXJmb3JtIG5vbi1mdW5jdGlvblwiKTtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gSWYgdGhlcmUncyBubyBkYXRhLCB0aGUgb2JqZWN0IGhhcyBiZWVuIHVub2JzZXJ2ZWRcclxuICAgICAgICAgICAgICAgICAgICB2YXIgZGF0YSA9IG9ic2VydmVkLmdldChvYmplY3QpLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBwcm9wLCBjaGFuZ2VSZWNvcmQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlc3VsdCA9IGZ1bmMuY2FsbChhcmd1bWVudHNbMl0pO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICBkYXRhICYmIHBlcmZvcm1Qcm9wZXJ0eUNoZWNrcyhkYXRhLCBvYmplY3QsIGNoYW5nZVR5cGUpO1xyXG5cclxuICAgICAgICAgICAgICAgICAgICAvLyBJZiB0aGVyZSdzIG5vIGRhdGEsIHRoZSBvYmplY3QgaGFzIGJlZW4gdW5vYnNlcnZlZFxyXG4gICAgICAgICAgICAgICAgICAgIGlmIChkYXRhICYmIHJlc3VsdCAmJiB0eXBlb2YgcmVzdWx0ID09PSBcIm9iamVjdFwiKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNoYW5nZVJlY29yZCA9IHsgb2JqZWN0OiBvYmplY3QsIHR5cGU6IGNoYW5nZVR5cGUgfTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZm9yIChwcm9wIGluIHJlc3VsdClcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwcm9wICE9PSBcIm9iamVjdFwiICYmIHByb3AgIT09IFwidHlwZVwiKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNoYW5nZVJlY29yZFtwcm9wXSA9IHJlc3VsdFtwcm9wXTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgYWRkQ2hhbmdlUmVjb3JkKG9iamVjdCwgZGF0YSwgY2hhbmdlUmVjb3JkKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgLyoqXHJcbiAgICAgICAgICogUmVnaXN0ZXIgKG9yIHJlZGVmaW5lcykgYW4gaGFuZGxlciBpbiB0aGUgY29sbGVjdGlvbiBmb3IgYSBnaXZlblxyXG4gICAgICAgICAqIG9iamVjdCBhbmQgYSBnaXZlbiB0eXBlIGFjY2VwdCBsaXN0LlxyXG4gICAgICAgICAqIEBmdW5jdGlvbiBzZXRIYW5kbGVyXHJcbiAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IG9iamVjdFxyXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0RGF0YX0gZGF0YVxyXG4gICAgICAgICAqIEBwYXJhbSB7SGFuZGxlcn0gaGFuZGxlclxyXG4gICAgICAgICAqIEBwYXJhbSB7U3RyaW5nW119IGFjY2VwdExpc3RcclxuICAgICAgICAgKi9cclxuICAgICAgICBzZXRIYW5kbGVyID0gZnVuY3Rpb24ob2JqZWN0LCBkYXRhLCBoYW5kbGVyLCBhY2NlcHRMaXN0KSB7XHJcbiAgICAgICAgICAgIHZhciBoZGF0YSA9IGhhbmRsZXJzLmdldChoYW5kbGVyKTtcclxuICAgICAgICAgICAgaWYgKCFoZGF0YSlcclxuICAgICAgICAgICAgICAgIGhhbmRsZXJzLnNldChoYW5kbGVyLCBoZGF0YSA9IHtcclxuICAgICAgICAgICAgICAgICAgICBvYnNlcnZlZDogY3JlYXRlTWFwKCksXHJcbiAgICAgICAgICAgICAgICAgICAgY2hhbmdlUmVjb3JkczogW11cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBoZGF0YS5vYnNlcnZlZC5zZXQob2JqZWN0LCB7XHJcbiAgICAgICAgICAgICAgICBhY2NlcHRMaXN0OiBhY2NlcHRMaXN0LnNsaWNlKCksXHJcbiAgICAgICAgICAgICAgICBkYXRhOiBkYXRhXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBkYXRhLmhhbmRsZXJzLnNldChoYW5kbGVyLCBoZGF0YSk7XHJcbiAgICAgICAgfSxcclxuXHJcbiAgICAgICAgLyoqXHJcbiAgICAgICAgICogQWRkcyBhIGNoYW5nZSByZWNvcmQgaW4gYSBnaXZlbiBPYmplY3REYXRhXHJcbiAgICAgICAgICogQGZ1bmN0aW9uIGFkZENoYW5nZVJlY29yZFxyXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3RcclxuICAgICAgICAgKiBAcGFyYW0ge09iamVjdERhdGF9IGRhdGFcclxuICAgICAgICAgKiBAcGFyYW0ge0NoYW5nZVJlY29yZH0gY2hhbmdlUmVjb3JkXHJcbiAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IFtleGNlcHRdXHJcbiAgICAgICAgICovXHJcbiAgICAgICAgYWRkQ2hhbmdlUmVjb3JkID0gZnVuY3Rpb24ob2JqZWN0LCBkYXRhLCBjaGFuZ2VSZWNvcmQsIGV4Y2VwdCkge1xyXG4gICAgICAgICAgICBkYXRhLmhhbmRsZXJzLmZvckVhY2goZnVuY3Rpb24oaGRhdGEpIHtcclxuICAgICAgICAgICAgICAgIHZhciBhY2NlcHRMaXN0ID0gaGRhdGEub2JzZXJ2ZWQuZ2V0KG9iamVjdCkuYWNjZXB0TGlzdDtcclxuICAgICAgICAgICAgICAgIC8vIElmIGV4Y2VwdCBpcyBkZWZpbmVkLCBOb3RpZmllci5wZXJmb3JtQ2hhbmdlIGhhcyBiZWVuXHJcbiAgICAgICAgICAgICAgICAvLyBjYWxsZWQsIHdpdGggZXhjZXB0IGFzIHRoZSB0eXBlLlxyXG4gICAgICAgICAgICAgICAgLy8gQWxsIHRoZSBoYW5kbGVycyB0aGF0IGFjY2VwdHMgdGhhdCB0eXBlIGFyZSBza2lwcGVkLlxyXG4gICAgICAgICAgICAgICAgaWYgKCh0eXBlb2YgZXhjZXB0ICE9PSBcInN0cmluZ1wiXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHx8IGluQXJyYXkoYWNjZXB0TGlzdCwgZXhjZXB0KSA9PT0gLTEpXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICYmIGluQXJyYXkoYWNjZXB0TGlzdCwgY2hhbmdlUmVjb3JkLnR5cGUpID4gLTEpXHJcbiAgICAgICAgICAgICAgICAgICAgaGRhdGEuY2hhbmdlUmVjb3Jkcy5wdXNoKGNoYW5nZVJlY29yZCk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH07XHJcblxyXG4gICAgb2JzZXJ2ZWQgPSBjcmVhdGVNYXAoKTtcclxuICAgIGhhbmRsZXJzID0gY3JlYXRlTWFwKCk7XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBAZnVuY3Rpb24gT2JqZWN0Lm9ic2VydmVcclxuICAgICAqIEBzZWUgaHR0cDovL2Fydi5naXRodWIuaW8vZWNtYXNjcmlwdC1vYmplY3Qtb2JzZXJ2ZS8jT2JqZWN0Lm9ic2VydmVcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3RcclxuICAgICAqIEBwYXJhbSB7SGFuZGxlcn0gaGFuZGxlclxyXG4gICAgICogQHBhcmFtIHtTdHJpbmdbXX0gW2FjY2VwdExpc3RdXHJcbiAgICAgKiBAdGhyb3dzIHtUeXBlRXJyb3J9XHJcbiAgICAgKiBAcmV0dXJucyB7T2JqZWN0fSAgICAgICAgICAgICAgIFRoZSBvYnNlcnZlZCBvYmplY3RcclxuICAgICAqL1xyXG4gICAgTy5vYnNlcnZlID0gZnVuY3Rpb24gb2JzZXJ2ZShvYmplY3QsIGhhbmRsZXIsIGFjY2VwdExpc3QpIHtcclxuICAgICAgICBpZiAoIW9iamVjdCB8fCB0eXBlb2Ygb2JqZWN0ICE9PSBcIm9iamVjdFwiICYmIHR5cGVvZiBvYmplY3QgIT09IFwiZnVuY3Rpb25cIilcclxuICAgICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIk9iamVjdC5vYnNlcnZlIGNhbm5vdCBvYnNlcnZlIG5vbi1vYmplY3RcIik7XHJcblxyXG4gICAgICAgIGlmICh0eXBlb2YgaGFuZGxlciAhPT0gXCJmdW5jdGlvblwiKVxyXG4gICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiT2JqZWN0Lm9ic2VydmUgY2Fubm90IGRlbGl2ZXIgdG8gbm9uLWZ1bmN0aW9uXCIpO1xyXG5cclxuICAgICAgICBpZiAoTy5pc0Zyb3plbiAmJiBPLmlzRnJvemVuKGhhbmRsZXIpKVxyXG4gICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiT2JqZWN0Lm9ic2VydmUgY2Fubm90IGRlbGl2ZXIgdG8gYSBmcm96ZW4gZnVuY3Rpb24gb2JqZWN0XCIpO1xyXG5cclxuICAgICAgICBpZiAodHlwZW9mIGFjY2VwdExpc3QgPT09IFwidW5kZWZpbmVkXCIpXHJcbiAgICAgICAgICAgIGFjY2VwdExpc3QgPSBkZWZhdWx0QWNjZXB0TGlzdDtcclxuICAgICAgICBlbHNlIGlmICghYWNjZXB0TGlzdCB8fCB0eXBlb2YgYWNjZXB0TGlzdCAhPT0gXCJvYmplY3RcIilcclxuICAgICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIlRoaXJkIGFyZ3VtZW50IHRvIE9iamVjdC5vYnNlcnZlIG11c3QgYmUgYW4gYXJyYXkgb2Ygc3RyaW5ncy5cIik7XHJcblxyXG4gICAgICAgIGRvT2JzZXJ2ZShvYmplY3QsIGhhbmRsZXIsIGFjY2VwdExpc3QpO1xyXG5cclxuICAgICAgICByZXR1cm4gb2JqZWN0O1xyXG4gICAgfTtcclxuXHJcbiAgICAvKipcclxuICAgICAqIEBmdW5jdGlvbiBPYmplY3QudW5vYnNlcnZlXHJcbiAgICAgKiBAc2VlIGh0dHA6Ly9hcnYuZ2l0aHViLmlvL2VjbWFzY3JpcHQtb2JqZWN0LW9ic2VydmUvI09iamVjdC51bm9ic2VydmVcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvYmplY3RcclxuICAgICAqIEBwYXJhbSB7SGFuZGxlcn0gaGFuZGxlclxyXG4gICAgICogQHRocm93cyB7VHlwZUVycm9yfVxyXG4gICAgICogQHJldHVybnMge09iamVjdH0gICAgICAgICBUaGUgZ2l2ZW4gb2JqZWN0XHJcbiAgICAgKi9cclxuICAgIE8udW5vYnNlcnZlID0gZnVuY3Rpb24gdW5vYnNlcnZlKG9iamVjdCwgaGFuZGxlcikge1xyXG4gICAgICAgIGlmIChvYmplY3QgPT09IG51bGwgfHwgdHlwZW9mIG9iamVjdCAhPT0gXCJvYmplY3RcIiAmJiB0eXBlb2Ygb2JqZWN0ICE9PSBcImZ1bmN0aW9uXCIpXHJcbiAgICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJPYmplY3QudW5vYnNlcnZlIGNhbm5vdCB1bm9ic2VydmUgbm9uLW9iamVjdFwiKTtcclxuXHJcbiAgICAgICAgaWYgKHR5cGVvZiBoYW5kbGVyICE9PSBcImZ1bmN0aW9uXCIpXHJcbiAgICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJPYmplY3QudW5vYnNlcnZlIGNhbm5vdCBkZWxpdmVyIHRvIG5vbi1mdW5jdGlvblwiKTtcclxuXHJcbiAgICAgICAgdmFyIGhkYXRhID0gaGFuZGxlcnMuZ2V0KGhhbmRsZXIpLCBvZGF0YTtcclxuXHJcbiAgICAgICAgaWYgKGhkYXRhICYmIChvZGF0YSA9IGhkYXRhLm9ic2VydmVkLmdldChvYmplY3QpKSkge1xyXG4gICAgICAgICAgICBoZGF0YS5vYnNlcnZlZC5mb3JFYWNoKGZ1bmN0aW9uKG9kYXRhLCBvYmplY3QpIHtcclxuICAgICAgICAgICAgICAgIHBlcmZvcm1Qcm9wZXJ0eUNoZWNrcyhvZGF0YS5kYXRhLCBvYmplY3QpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgbmV4dEZyYW1lKGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICAgICAgZGVsaXZlckhhbmRsZXJSZWNvcmRzKGhkYXRhLCBoYW5kbGVyKTtcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICAvLyBJbiBGaXJlZm94IDEzLTE4LCBzaXplIGlzIGEgZnVuY3Rpb24sIGJ1dCBjcmVhdGVNYXAgc2hvdWxkIGZhbGxcclxuICAgICAgICAgICAgLy8gYmFjayB0byB0aGUgc2hpbSBmb3IgdGhvc2UgdmVyc2lvbnNcclxuICAgICAgICAgICAgaWYgKGhkYXRhLm9ic2VydmVkLnNpemUgPT09IDEgJiYgaGRhdGEub2JzZXJ2ZWQuaGFzKG9iamVjdCkpXHJcbiAgICAgICAgICAgICAgICBoYW5kbGVyc1tcImRlbGV0ZVwiXShoYW5kbGVyKTtcclxuICAgICAgICAgICAgZWxzZSBoZGF0YS5vYnNlcnZlZFtcImRlbGV0ZVwiXShvYmplY3QpO1xyXG5cclxuICAgICAgICAgICAgaWYgKG9kYXRhLmRhdGEuaGFuZGxlcnMuc2l6ZSA9PT0gMSlcclxuICAgICAgICAgICAgICAgIG9ic2VydmVkW1wiZGVsZXRlXCJdKG9iamVjdCk7XHJcbiAgICAgICAgICAgIGVsc2Ugb2RhdGEuZGF0YS5oYW5kbGVyc1tcImRlbGV0ZVwiXShoYW5kbGVyKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHJldHVybiBvYmplY3Q7XHJcbiAgICB9O1xyXG5cclxuICAgIC8qKlxyXG4gICAgICogQGZ1bmN0aW9uIE9iamVjdC5nZXROb3RpZmllclxyXG4gICAgICogQHNlZSBodHRwOi8vYXJ2LmdpdGh1Yi5pby9lY21hc2NyaXB0LW9iamVjdC1vYnNlcnZlLyNHZXROb3RpZmllclxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9iamVjdFxyXG4gICAgICogQHRocm93cyB7VHlwZUVycm9yfVxyXG4gICAgICogQHJldHVybnMge05vdGlmaWVyfVxyXG4gICAgICovXHJcbiAgICBPLmdldE5vdGlmaWVyID0gZnVuY3Rpb24gZ2V0Tm90aWZpZXIob2JqZWN0KSB7XHJcbiAgICAgICAgaWYgKG9iamVjdCA9PT0gbnVsbCB8fCB0eXBlb2Ygb2JqZWN0ICE9PSBcIm9iamVjdFwiICYmIHR5cGVvZiBvYmplY3QgIT09IFwiZnVuY3Rpb25cIilcclxuICAgICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIk9iamVjdC5nZXROb3RpZmllciBjYW5ub3QgZ2V0Tm90aWZpZXIgbm9uLW9iamVjdFwiKTtcclxuXHJcbiAgICAgICAgaWYgKE8uaXNGcm96ZW4gJiYgTy5pc0Zyb3plbihvYmplY3QpKSByZXR1cm4gbnVsbDtcclxuXHJcbiAgICAgICAgcmV0dXJuIHJldHJpZXZlTm90aWZpZXIob2JqZWN0KTtcclxuICAgIH07XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBAZnVuY3Rpb24gT2JqZWN0LmRlbGl2ZXJDaGFuZ2VSZWNvcmRzXHJcbiAgICAgKiBAc2VlIGh0dHA6Ly9hcnYuZ2l0aHViLmlvL2VjbWFzY3JpcHQtb2JqZWN0LW9ic2VydmUvI09iamVjdC5kZWxpdmVyQ2hhbmdlUmVjb3Jkc1xyXG4gICAgICogQHNlZSBodHRwOi8vYXJ2LmdpdGh1Yi5pby9lY21hc2NyaXB0LW9iamVjdC1vYnNlcnZlLyNEZWxpdmVyQ2hhbmdlUmVjb3Jkc1xyXG4gICAgICogQHBhcmFtIHtIYW5kbGVyfSBoYW5kbGVyXHJcbiAgICAgKiBAdGhyb3dzIHtUeXBlRXJyb3J9XHJcbiAgICAgKi9cclxuICAgIE8uZGVsaXZlckNoYW5nZVJlY29yZHMgPSBmdW5jdGlvbiBkZWxpdmVyQ2hhbmdlUmVjb3JkcyhoYW5kbGVyKSB7XHJcbiAgICAgICAgaWYgKHR5cGVvZiBoYW5kbGVyICE9PSBcImZ1bmN0aW9uXCIpXHJcbiAgICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJPYmplY3QuZGVsaXZlckNoYW5nZVJlY29yZHMgY2Fubm90IGRlbGl2ZXIgdG8gbm9uLWZ1bmN0aW9uXCIpO1xyXG5cclxuICAgICAgICB2YXIgaGRhdGEgPSBoYW5kbGVycy5nZXQoaGFuZGxlcik7XHJcbiAgICAgICAgaWYgKGhkYXRhKSB7XHJcbiAgICAgICAgICAgIGhkYXRhLm9ic2VydmVkLmZvckVhY2goZnVuY3Rpb24ob2RhdGEsIG9iamVjdCkge1xyXG4gICAgICAgICAgICAgICAgcGVyZm9ybVByb3BlcnR5Q2hlY2tzKG9kYXRhLmRhdGEsIG9iamVjdCk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBkZWxpdmVySGFuZGxlclJlY29yZHMoaGRhdGEsIGhhbmRsZXIpO1xyXG4gICAgICAgIH1cclxuICAgIH07XHJcblxyXG59KShPYmplY3QsIEFycmF5LCB0aGlzKTtcbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwib01mcEFuXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvLi4vLi4vbm9kZV9tb2R1bGVzL29iamVjdC5vYnNlcnZlL2Rpc3Qvb2JqZWN0LW9ic2VydmUuanNcIixcIi8uLi8uLi9ub2RlX21vZHVsZXMvb2JqZWN0Lm9ic2VydmUvZGlzdFwiKSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSAoZnVuY3Rpb24gKCkge1xuXG4gICAgdmFyIGRlcHRoU3RyaW5nID0gJyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJztcblxuICAgIGZ1bmN0aW9uIERhdGFOb2RlQmFzZShrZXkpIHtcbiAgICAgICAgdGhpcy5sYWJlbCA9IGtleTtcbiAgICAgICAgdGhpcy5kYXRhID0gWycnXTtcbiAgICAgICAgdGhpcy5yb3dJbmRleGVzID0gW107XG4gICAgICAgIHRoaXMuaGFzQ2hpbGRyZW4gPSBmYWxzZTtcbiAgICAgICAgdGhpcy5kZXB0aCA9IDA7XG4gICAgICAgIHRoaXMuaGVpZ2h0ID0gMTtcbiAgICAgICAgdGhpcy5leHBhbmRlZCA9IGZhbHNlO1xuICAgIH1cblxuICAgIERhdGFOb2RlQmFzZS5wcm90b3R5cGUuaXNOdWxsT2JqZWN0ID0gZmFsc2U7XG5cbiAgICBEYXRhTm9kZUJhc2UucHJvdG90eXBlLmdldFZhbHVlID0gZnVuY3Rpb24gKHgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGF0YVt4XTtcbiAgICB9O1xuXG4gICAgRGF0YU5vZGVCYXNlLnByb3RvdHlwZS5wcnVuZSA9IGZ1bmN0aW9uIChkZXB0aCkge1xuICAgICAgICB0aGlzLmRlcHRoID0gZGVwdGg7XG4gICAgICAgIHRoaXMuZGF0YVswXSA9IHRoaXMuY29tcHV0ZURlcHRoU3RyaW5nKCk7XG4gICAgfTtcblxuICAgIERhdGFOb2RlQmFzZS5wcm90b3R5cGUuY29tcHV0ZURlcHRoU3RyaW5nID0gZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgc3RyaW5nID0gZGVwdGhTdHJpbmcuc3Vic3RyaW5nKDAsIDIgKyAodGhpcy5kZXB0aCAqIDMpKSArIHRoaXMubGFiZWw7XG4gICAgICAgIHJldHVybiBzdHJpbmc7XG4gICAgfTtcblxuICAgIERhdGFOb2RlQmFzZS5wcm90b3R5cGUuY29tcHV0ZUhlaWdodCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIDE7XG4gICAgfTtcblxuICAgIERhdGFOb2RlQmFzZS5wcm90b3R5cGUuZ2V0QWxsUm93SW5kZXhlcyA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucm93SW5kZXhlcztcbiAgICB9O1xuXG4gICAgRGF0YU5vZGVCYXNlLnByb3RvdHlwZS5jb21wdXRlQWdncmVnYXRlcyA9IGZ1bmN0aW9uIChhZ2dyZWdhdG9yKSB7XG4gICAgICAgIHRoaXMuYXBwbHlBZ2dyZWdhdGVzKGFnZ3JlZ2F0b3IpO1xuICAgIH07XG5cbiAgICBEYXRhTm9kZUJhc2UucHJvdG90eXBlLmFwcGx5QWdncmVnYXRlcyA9IGZ1bmN0aW9uIChhZ2dyZWdhdG9yKSB7XG4gICAgICAgIHZhciBoYXNHcm91cHNPZmZzZXQgPSBhZ2dyZWdhdG9yLmhhc0dyb3VwcygpID8gMSA6IDA7XG4gICAgICAgIHZhciBpbmRleGVzID0gdGhpcy5nZXRBbGxSb3dJbmRleGVzKCk7XG4gICAgICAgIGlmIChpbmRleGVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgcmV0dXJuOyAvLyBubyBkYXRhIHRvIHJvbGx1cCBvblxuICAgICAgICB9XG4gICAgICAgIHZhciBhZ2dyZWdhdGVzID0gYWdncmVnYXRvci5hZ2dyZWdhdGVzO1xuICAgICAgICB2YXIgZGF0YSA9IHRoaXMuZGF0YTtcbiAgICAgICAgZGF0YS5sZW5ndGggPSBhZ2dyZWdhdGVzLmxlbmd0aCArIGhhc0dyb3Vwc09mZnNldDtcblxuICAgICAgICB2YXIgc29ydGVyID0gYWdncmVnYXRvci5zb3J0ZXJJbnN0YW5jZTtcbiAgICAgICAgc29ydGVyLmluZGV4ZXMgPSBpbmRleGVzO1xuXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYWdncmVnYXRlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdmFyIGFnZ3JlZ2F0ZSA9IGFnZ3JlZ2F0ZXNbaV07XG4gICAgICAgICAgICBkYXRhW2kgKyBoYXNHcm91cHNPZmZzZXRdID0gYWdncmVnYXRlKHNvcnRlcik7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmRhdGEgPSBkYXRhO1xuICAgIH07XG5cbiAgICBEYXRhTm9kZUJhc2UucHJvdG90eXBlLmJ1aWxkVmlldyA9IGZ1bmN0aW9uIChhZ2dyZWdhdG9yKSB7XG4gICAgICAgIGFnZ3JlZ2F0b3Iudmlldy5wdXNoKHRoaXMpO1xuICAgIH07XG5cbiAgICBEYXRhTm9kZUJhc2UucHJvdG90eXBlLnRvZ2dsZUV4cGFuc2lvblN0YXRlID0gZnVuY3Rpb24gKCkgeyAvKiBhZ2dyZWdhdG9yICovXG4gICAgICAgIC8vZG8gbm90aGluZyBieSBkZWZhdWx0XG4gICAgfTtcblxuICAgIHJldHVybiBEYXRhTm9kZUJhc2U7XG5cbn0pKCk7XG5cbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwib01mcEFuXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvRGF0YU5vZGVCYXNlLmpzXCIsXCIvXCIpIiwiKGZ1bmN0aW9uIChwcm9jZXNzLGdsb2JhbCxCdWZmZXIsX19hcmd1bWVudDAsX19hcmd1bWVudDEsX19hcmd1bWVudDIsX19hcmd1bWVudDMsX19maWxlbmFtZSxfX2Rpcm5hbWUpe1xuJ3VzZSBzdHJpY3QnO1xuXG52YXIgTWFwID0gcmVxdWlyZSgnLi9NYXAnKTtcbnZhciBEYXRhTm9kZUJhc2UgPSByZXF1aXJlKCcuL0RhdGFOb2RlQmFzZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IChmdW5jdGlvbiAoKSB7XG5cbiAgICB2YXIgRXhwYW5kZWRNYXAgPSB7XG4gICAgICAgIHRydWU6ICfilr4nLFxuICAgICAgICBmYWxzZTogJ+KWuCdcbiAgICB9O1xuICAgIHZhciBkZXB0aFN0cmluZyA9ICcgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICc7XG5cbiAgICBmdW5jdGlvbiBEYXRhTm9kZUdyb3VwKGtleSkge1xuICAgICAgICBEYXRhTm9kZUJhc2UuY2FsbCh0aGlzLCBrZXkpO1xuICAgICAgICB0aGlzLmNoaWxkcmVuID0gbmV3IE1hcCgpO1xuICAgIH1cblxuICAgIERhdGFOb2RlR3JvdXAucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShEYXRhTm9kZUJhc2UucHJvdG90eXBlKTtcblxuICAgIERhdGFOb2RlR3JvdXAucHJvdG90eXBlLnBydW5lID0gZnVuY3Rpb24gKGRlcHRoKSB7XG4gICAgICAgIHRoaXMuZGVwdGggPSBkZXB0aDtcbiAgICAgICAgdGhpcy5jaGlsZHJlbiA9IHRoaXMuY2hpbGRyZW4udmFsdWVzO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMuY2hpbGRyZW4ubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBjaGlsZCA9IHRoaXMuY2hpbGRyZW5baV07XG4gICAgICAgICAgICBjaGlsZC5wcnVuZSh0aGlzLmRlcHRoICsgMSk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5kYXRhWzBdID0gdGhpcy5jb21wdXRlRGVwdGhTdHJpbmcoKTtcbiAgICB9O1xuXG4gICAgRGF0YU5vZGVHcm91cC5wcm90b3R5cGUuY29tcHV0ZURlcHRoU3RyaW5nID0gZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgaWNvbiA9IEV4cGFuZGVkTWFwW3RoaXMuZXhwYW5kZWQgKyAnJ107XG4gICAgICAgIHZhciBzdHJpbmcgPSBkZXB0aFN0cmluZy5zdWJzdHJpbmcoMCwgdGhpcy5kZXB0aCAqIDMpICsgaWNvbiArICcgJyArIHRoaXMubGFiZWw7XG4gICAgICAgIHJldHVybiBzdHJpbmc7XG4gICAgfTtcblxuICAgIERhdGFOb2RlR3JvdXAucHJvdG90eXBlLmdldEFsbFJvd0luZGV4ZXMgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmICh0aGlzLnJvd0luZGV4ZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICB0aGlzLnJvd0luZGV4ZXMgPSB0aGlzLmNvbXB1dGVBbGxSb3dJbmRleGVzKCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMucm93SW5kZXhlcztcbiAgICB9O1xuXG4gICAgRGF0YU5vZGVHcm91cC5wcm90b3R5cGUuY29tcHV0ZUFsbFJvd0luZGV4ZXMgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciByZXN1bHQgPSBbXTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLmNoaWxkcmVuLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICB2YXIgY2hpbGQgPSB0aGlzLmNoaWxkcmVuW2ldO1xuICAgICAgICAgICAgdmFyIGNoaWxkSW5kZXhlcyA9IGNoaWxkLmdldEFsbFJvd0luZGV4ZXMoKTtcbiAgICAgICAgICAgIEFycmF5LnByb3RvdHlwZS5zcGxpY2UuYXBwbHkocmVzdWx0LCBbcmVzdWx0Lmxlbmd0aCwgMF0uY29uY2F0KGNoaWxkSW5kZXhlcykpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfTtcblxuICAgIERhdGFOb2RlR3JvdXAucHJvdG90eXBlLnRvZ2dsZUV4cGFuc2lvblN0YXRlID0gZnVuY3Rpb24gKGFnZ3JlZ2F0b3IpIHsgLyogYWdncmVnYXRvciAqL1xuICAgICAgICB0aGlzLmV4cGFuZGVkID0gIXRoaXMuZXhwYW5kZWQ7XG4gICAgICAgIHRoaXMuZGF0YVswXSA9IHRoaXMuY29tcHV0ZURlcHRoU3RyaW5nKCk7XG4gICAgICAgIGlmICh0aGlzLmV4cGFuZGVkKSB7XG4gICAgICAgICAgICB0aGlzLmNvbXB1dGVBZ2dyZWdhdGVzKGFnZ3JlZ2F0b3IpO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIERhdGFOb2RlR3JvdXAucHJvdG90eXBlLmNvbXB1dGVBZ2dyZWdhdGVzID0gZnVuY3Rpb24gKGFnZ3JlZ2F0b3IpIHtcbiAgICAgICAgdGhpcy5hcHBseUFnZ3JlZ2F0ZXMoYWdncmVnYXRvcik7XG4gICAgICAgIGlmICghdGhpcy5leHBhbmRlZCkge1xuICAgICAgICAgICAgcmV0dXJuOyAvLyB3ZXJlIG5vdCBiZWluZyB2aWV3ZWQsIGRvbid0IGhhdmUgY2hpbGQgbm9kZXMgZG8gY29tcHV0YXRpb247XG4gICAgICAgIH1cbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLmNoaWxkcmVuLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICB0aGlzLmNoaWxkcmVuW2ldLmNvbXB1dGVBZ2dyZWdhdGVzKGFnZ3JlZ2F0b3IpO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIERhdGFOb2RlR3JvdXAucHJvdG90eXBlLmJ1aWxkVmlldyA9IGZ1bmN0aW9uIChhZ2dyZWdhdG9yKSB7XG4gICAgICAgIGFnZ3JlZ2F0b3Iudmlldy5wdXNoKHRoaXMpO1xuICAgICAgICBpZiAodGhpcy5leHBhbmRlZCkge1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLmNoaWxkcmVuLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgdmFyIGNoaWxkID0gdGhpcy5jaGlsZHJlbltpXTtcbiAgICAgICAgICAgICAgICBjaGlsZC5idWlsZFZpZXcoYWdncmVnYXRvcik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgRGF0YU5vZGVHcm91cC5wcm90b3R5cGUuY29tcHV0ZUhlaWdodCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIGhlaWdodCA9IDE7IC8vSSdtIDEgaGlnaFxuICAgICAgICBpZiAoIXRoaXMuZXhwYW5kZWQpIHtcbiAgICAgICAgICAgIHRoaXMuaGVpZ2h0ID0gMTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy5jaGlsZHJlbi5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgIGhlaWdodCA9IGhlaWdodCArIHRoaXMuY2hpbGRyZW5baV0uY29tcHV0ZUhlaWdodCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5oZWlnaHQgPSBoZWlnaHQ7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuaGVpZ2h0O1xuICAgIH07XG5cbiAgICByZXR1cm4gRGF0YU5vZGVHcm91cDtcblxufSkoKTtcbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwib01mcEFuXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvRGF0YU5vZGVHcm91cC5qc1wiLFwiL1wiKSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbid1c2Ugc3RyaWN0JztcblxudmFyIERhdGFOb2RlQmFzZSA9IHJlcXVpcmUoJy4vRGF0YU5vZGVCYXNlJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gKGZ1bmN0aW9uICgpIHtcblxuICAgIGZ1bmN0aW9uIERhdGFOb2RlTGVhZihrZXkpIHtcbiAgICAgICAgRGF0YU5vZGVCYXNlLmNhbGwodGhpcywga2V5KTtcbiAgICB9XG5cbiAgICBEYXRhTm9kZUxlYWYucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShEYXRhTm9kZUJhc2UucHJvdG90eXBlKTtcblxuICAgIERhdGFOb2RlTGVhZi5wcm90b3R5cGUucHJ1bmUgPSBmdW5jdGlvbiAoZGVwdGgpIHtcbiAgICAgICAgdGhpcy5kZXB0aCA9IGRlcHRoO1xuICAgICAgICB0aGlzLmRhdGFbMF0gPSB0aGlzLmNvbXB1dGVEZXB0aFN0cmluZygpO1xuICAgIH07XG5cbiAgICBEYXRhTm9kZUxlYWYucHJvdG90eXBlLmNvbXB1dGVIZWlnaHQgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiAxO1xuICAgIH07XG5cbiAgICBEYXRhTm9kZUxlYWYucHJvdG90eXBlLmdldEFsbFJvd0luZGV4ZXMgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnJvd0luZGV4ZXM7XG4gICAgfTtcblxuICAgIERhdGFOb2RlTGVhZi5wcm90b3R5cGUuY29tcHV0ZUFnZ3JlZ2F0ZXMgPSBmdW5jdGlvbiAoYWdncmVnYXRvcikge1xuICAgICAgICB0aGlzLmFwcGx5QWdncmVnYXRlcyhhZ2dyZWdhdG9yKTtcbiAgICB9O1xuXG4gICAgRGF0YU5vZGVMZWFmLnByb3RvdHlwZS5idWlsZFZpZXcgPSBmdW5jdGlvbiAoYWdncmVnYXRvcikge1xuICAgICAgICBhZ2dyZWdhdG9yLnZpZXcucHVzaCh0aGlzKTtcbiAgICB9O1xuXG4gICAgcmV0dXJuIERhdGFOb2RlTGVhZjtcblxufSkoKTtcbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwib01mcEFuXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvRGF0YU5vZGVMZWFmLmpzXCIsXCIvXCIpIiwiKGZ1bmN0aW9uIChwcm9jZXNzLGdsb2JhbCxCdWZmZXIsX19hcmd1bWVudDAsX19hcmd1bWVudDEsX19hcmd1bWVudDIsX19hcmd1bWVudDMsX19maWxlbmFtZSxfX2Rpcm5hbWUpe1xuJ3VzZSBzdHJpY3QnO1xuXG52YXIgRGF0YU5vZGVHcm91cCA9IHJlcXVpcmUoJy4vRGF0YU5vZGVHcm91cCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IChmdW5jdGlvbiAoKSB7XG5cbiAgICBmdW5jdGlvbiBEYXRhTm9kZVRyZWUoa2V5KSB7XG4gICAgICAgIERhdGFOb2RlR3JvdXAuY2FsbCh0aGlzLCBrZXkpO1xuICAgICAgICB0aGlzLmhlaWdodCA9IDA7XG4gICAgICAgIHRoaXMuZXhwYW5kZWQgPSB0cnVlO1xuICAgIH1cblxuICAgIERhdGFOb2RlVHJlZS5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKERhdGFOb2RlR3JvdXAucHJvdG90eXBlKTtcblxuICAgIERhdGFOb2RlVHJlZS5wcm90b3R5cGUucHJ1bmUgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuY2hpbGRyZW4gPSB0aGlzLmNoaWxkcmVuLnZhbHVlcztcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLmNoaWxkcmVuLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICB2YXIgY2hpbGQgPSB0aGlzLmNoaWxkcmVuW2ldO1xuICAgICAgICAgICAgY2hpbGQucHJ1bmUoMCk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgRGF0YU5vZGVUcmVlLnByb3RvdHlwZS5idWlsZFZpZXcgPSBmdW5jdGlvbiAoYWdncmVnYXRvcikge1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMuY2hpbGRyZW4ubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBjaGlsZCA9IHRoaXMuY2hpbGRyZW5baV07XG4gICAgICAgICAgICBjaGlsZC5idWlsZFZpZXcoYWdncmVnYXRvcik7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgRGF0YU5vZGVUcmVlLnByb3RvdHlwZS5jb21wdXRlSGVpZ2h0ID0gZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgaGVpZ2h0ID0gMTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLmNoaWxkcmVuLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBoZWlnaHQgPSBoZWlnaHQgKyB0aGlzLmNoaWxkcmVuW2ldLmNvbXB1dGVIZWlnaHQoKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmhlaWdodCA9IGhlaWdodDtcblxuICAgICAgICByZXR1cm4gdGhpcy5oZWlnaHQ7XG4gICAgfTtcblxuXG4gICAgcmV0dXJuIERhdGFOb2RlVHJlZTtcblxufSkoKTtcblxufSkuY2FsbCh0aGlzLHJlcXVpcmUoXCJvTWZwQW5cIiksdHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIgPyBzZWxmIDogdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHt9LHJlcXVpcmUoXCJidWZmZXJcIikuQnVmZmVyLGFyZ3VtZW50c1szXSxhcmd1bWVudHNbNF0sYXJndW1lbnRzWzVdLGFyZ3VtZW50c1s2XSxcIi9EYXRhTm9kZVRyZWUuanNcIixcIi9cIikiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG4ndXNlIHN0cmljdCc7XG5cbnZhciBEYXRhU291cmNlU29ydGVyID0gcmVxdWlyZSgnLi9EYXRhU291cmNlU29ydGVyJyk7XG52YXIgRGF0YU5vZGVUcmVlID0gcmVxdWlyZSgnLi9EYXRhTm9kZVRyZWUnKTtcbnZhciBEYXRhTm9kZUdyb3VwID0gcmVxdWlyZSgnLi9EYXRhTm9kZUdyb3VwJyk7XG52YXIgRGF0YU5vZGVMZWFmID0gcmVxdWlyZSgnLi9EYXRhTm9kZUxlYWYnKTtcbnZhciBEYXRhTm9kZUxlYWYgPSByZXF1aXJlKCcuL0RhdGFOb2RlTGVhZicpO1xudmFyIEFnZ3JlZ2F0aW9ucyA9IHJlcXVpcmUoJy4vYWdncmVnYXRpb25zJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gKGZ1bmN0aW9uICgpIHtcblxuICAgIHZhciBoZWFkZXJpZnkgPSBmdW5jdGlvbiAoc3RyaW5nKSB7XG4gICAgICAgIHZhciBwaWVjZXMgPSBzdHJpbmcucmVwbGFjZSgvW18tXS9nLCAnICcpLnJlcGxhY2UoL1tBLVpdL2csICcgJCYnKS5zcGxpdCgnICcpLm1hcChmdW5jdGlvbiAocykge1xuICAgICAgICAgICAgcmV0dXJuIChzLmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpICsgcy5zbGljZSgxKSkudHJpbSgpO1xuICAgICAgICB9KTtcbiAgICAgICAgcGllY2VzID0gcGllY2VzLmZpbHRlcihmdW5jdGlvbiAoZSkge1xuICAgICAgICAgICAgcmV0dXJuIGUubGVuZ3RoICE9PSAwO1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHBpZWNlcy5qb2luKCcgJykudHJpbSgpO1xuICAgIH07XG5cbiAgICAvLz9bdCxjLGIsYV1cbiAgICAvLyB0IGlzIGEgZGF0YVNvdXJjZSxcbiAgICAvLyBhIGlzIGEgZGljaXRpb25hcnkgb2YgYWdncmVnYXRlcywgIGNvbHVtbk5hbWU6ZnVuY3Rpb25cbiAgICAvLyBiIGlzIGEgZGljaXRpb25hcnkgb2YgZ3JvdXBieXMsIGNvbHVtbk5hbWU6c291cmNlQ29sdW1uTmFtZVxuICAgIC8vIGMgaXMgYSBsaXN0IG9mIGNvbnN0cmFpbnRzLFxuXG4gICAgZnVuY3Rpb24gRGF0YVNvdXJjZUFnZ3JlZ2F0b3IoZGF0YVNvdXJjZSkge1xuICAgICAgICB0aGlzLnRyZWUgPSBuZXcgRGF0YU5vZGVUcmVlKCdUb3RhbHMnKTtcbiAgICAgICAgdGhpcy5pbmRleGVzID0gW107XG4gICAgICAgIHRoaXMuZGF0YVNvdXJjZSA9IGRhdGFTb3VyY2U7XG4gICAgICAgIHRoaXMuYWdncmVnYXRlcyA9IFtdO1xuICAgICAgICB0aGlzLmhlYWRlcnMgPSBbXTtcbiAgICAgICAgdGhpcy5ncm91cEJ5cyA9IFtdO1xuICAgICAgICB0aGlzLnZpZXcgPSBbXTtcbiAgICAgICAgdGhpcy5zb3J0ZXJJbnN0YW5jZSA9IHt9O1xuICAgICAgICB0aGlzLnByZXNvcnRHcm91cHMgPSB0cnVlO1xuICAgICAgICB0aGlzLmxhc3RBZ2dyZWdhdGUgPSB7fTtcbiAgICAgICAgdGhpcy5zZXRBZ2dyZWdhdGVzKHt9KTtcbiAgICB9XG5cbiAgICBEYXRhU291cmNlQWdncmVnYXRvci5wcm90b3R5cGUuaXNOdWxsT2JqZWN0ID0gZmFsc2U7XG5cbiAgICBEYXRhU291cmNlQWdncmVnYXRvci5wcm90b3R5cGUuc2V0QWdncmVnYXRlcyA9IGZ1bmN0aW9uKGFnZ3JlZ2F0aW9ucykge1xuICAgICAgICB0aGlzLmxhc3RBZ2dyZWdhdGUgPSBhZ2dyZWdhdGlvbnM7XG4gICAgICAgIHZhciBwcm9wcyA9IFtdO1xuICAgICAgICB2YXIgaTtcbiAgICAgICAgdGhpcy5jbGVhckFnZ3JlZ2F0aW9ucygpO1xuICAgICAgICB0aGlzLmhlYWRlcnMubGVuZ3RoID0gMDtcblxuICAgICAgICBmb3IgKHZhciBrZXkgaW4gYWdncmVnYXRpb25zKSB7XG4gICAgICAgICAgICBwcm9wcy5wdXNoKFtrZXksIGFnZ3JlZ2F0aW9uc1trZXldXSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBpZiAocHJvcHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIC8vICAgICB2YXIgZmllbGRzID0gW10uY29uY2F0KHRoaXMuZGF0YVNvdXJjZS5nZXRGaWVsZHMoKSk7XG4gICAgICAgIC8vICAgICBmb3IgKGkgPSAwOyBpIDwgZmllbGRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIC8vICAgICAgICAgcHJvcHMucHVzaChbZmllbGRzW2ldLCBBZ2dyZWdhdGlvbnMuZmlyc3QoaSldKTsgLyoganNoaW50IGlnbm9yZTpsaW5lICovXG4gICAgICAgIC8vICAgICB9XG4gICAgICAgIC8vIH1cblxuICAgICAgICBpZih0aGlzLmhhc0dyb3VwcygpKSB7XG4gICAgICAgICAgICB0aGlzLmhlYWRlcnMucHVzaCgnVHJlZScpO1xuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChpID0gMDsgaSA8IHByb3BzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICB2YXIgYWdnID0gcHJvcHNbaV07XG4gICAgICAgICAgICB0aGlzLmFkZEFnZ3JlZ2F0ZShhZ2dbMF0sIGFnZ1sxXSk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgRGF0YVNvdXJjZUFnZ3JlZ2F0b3IucHJvdG90eXBlLmFkZEFnZ3JlZ2F0ZSA9IGZ1bmN0aW9uKGxhYmVsLCBmdW5jKSB7XG4gICAgICAgIHRoaXMuaGVhZGVycy5wdXNoKGhlYWRlcmlmeShsYWJlbCkpO1xuICAgICAgICB0aGlzLmFnZ3JlZ2F0ZXMucHVzaChmdW5jKTtcbiAgICB9O1xuXG4gICAgRGF0YVNvdXJjZUFnZ3JlZ2F0b3IucHJvdG90eXBlLnNldEdyb3VwQnlzID0gZnVuY3Rpb24gKGNvbHVtbkluZGV4QXJyYXkpIHtcbiAgICAgICAgdGhpcy5ncm91cEJ5cy5sZW5ndGggPSAwO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGNvbHVtbkluZGV4QXJyYXkubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHRoaXMuZ3JvdXBCeXMucHVzaChjb2x1bW5JbmRleEFycmF5W2ldKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnNldEFnZ3JlZ2F0ZXModGhpcy5sYXN0QWdncmVnYXRlKTtcbiAgICB9O1xuXG4gICAgRGF0YVNvdXJjZUFnZ3JlZ2F0b3IucHJvdG90eXBlLmFkZEdyb3VwQnkgPSBmdW5jdGlvbihpbmRleCkge1xuICAgICAgICAgICAgdGhpcy5ncm91cEJ5cy5wdXNoKGluZGV4KTtcbiAgICB9O1xuXG4gICAgRGF0YVNvdXJjZUFnZ3JlZ2F0b3IucHJvdG90eXBlLmhhc0dyb3VwcyA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ3JvdXBCeXMubGVuZ3RoID4gMDtcbiAgICB9O1xuXG4gICAgRGF0YVNvdXJjZUFnZ3JlZ2F0b3IucHJvdG90eXBlLmhhc0FnZ3JlZ2F0ZXMgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmFnZ3JlZ2F0ZXMubGVuZ3RoID4gMDtcbiAgICB9O1xuXG4gICAgRGF0YVNvdXJjZUFnZ3JlZ2F0b3IucHJvdG90eXBlLmFwcGx5ID0gZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmJ1aWxkR3JvdXBUcmVlKCk7XG4gICAgfTtcblxuICAgIERhdGFTb3VyY2VBZ2dyZWdhdG9yLnByb3RvdHlwZS5jbGVhckdyb3VwcyA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5ncm91cEJ5cy5sZW5ndGggPSAwO1xuICAgIH07XG5cbiAgICBEYXRhU291cmNlQWdncmVnYXRvci5wcm90b3R5cGUuY2xlYXJBZ2dyZWdhdGlvbnMgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuYWdncmVnYXRlcy5sZW5ndGggPSAwO1xuICAgICAgICB0aGlzLmhlYWRlcnMubGVuZ3RoID0gMDtcbiAgICB9O1xuXG4gICAgRGF0YVNvdXJjZUFnZ3JlZ2F0b3IucHJvdG90eXBlLmJ1aWxkR3JvdXBUcmVlID0gZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgYywgciwgZywgdmFsdWUsIGNyZWF0ZUZ1bmM7XG4gICAgICAgIHZhciBjcmVhdGVCcmFuY2ggPSBmdW5jdGlvbiAoa2V5LCBtYXApIHtcbiAgICAgICAgICAgIHZhbHVlID0gbmV3IERhdGFOb2RlR3JvdXAoa2V5KTtcbiAgICAgICAgICAgIG1hcC5zZXQoa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgICAgIH07XG4gICAgICAgIHZhciBjcmVhdGVMZWFmID0gZnVuY3Rpb24gKGtleSwgbWFwKSB7XG4gICAgICAgICAgICB2YWx1ZSA9IG5ldyBEYXRhTm9kZUxlYWYoa2V5KTtcbiAgICAgICAgICAgIG1hcC5zZXQoa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgICAgIH07XG4gICAgICAgIHZhciBncm91cEJ5cyA9IHRoaXMuZ3JvdXBCeXM7XG4gICAgICAgIHZhciBzb3VyY2UgPSB0aGlzLmRhdGFTb3VyY2U7XG4gICAgICAgIHZhciByb3dDb3VudCA9IHNvdXJjZS5nZXRSb3dDb3VudCgpO1xuXG4gICAgICAgIC8vIGxldHMgc29ydCBvdXIgZGF0YSBmaXJzdC4uLi5cbiAgICAgICAgaWYgKHRoaXMucHJlc29ydEdyb3Vwcykge1xuICAgICAgICAgICAgZm9yIChjID0gMDsgYyA8IGdyb3VwQnlzLmxlbmd0aDsgYysrKSB7XG4gICAgICAgICAgICAgICAgZyA9IGdyb3VwQnlzW2dyb3VwQnlzLmxlbmd0aCAtIGMgLSAxXTtcbiAgICAgICAgICAgICAgICBzb3VyY2UgPSBuZXcgRGF0YVNvdXJjZVNvcnRlcihzb3VyY2UpO1xuICAgICAgICAgICAgICAgIHNvdXJjZS5zb3J0T24oZyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgdHJlZSA9IHRoaXMudHJlZSA9IG5ldyBEYXRhTm9kZVRyZWUoJ3Jvb3QnKTtcbiAgICAgICAgdmFyIHBhdGggPSB0cmVlO1xuICAgICAgICB2YXIgbGVhZkRlcHRoID0gZ3JvdXBCeXMubGVuZ3RoIC0gMTtcbiAgICAgICAgZm9yIChyID0gMDsgciA8IHJvd0NvdW50OyByKyspIHtcbiAgICAgICAgICAgIGZvciAoYyA9IDA7IGMgPCBncm91cEJ5cy5sZW5ndGg7IGMrKykge1xuICAgICAgICAgICAgICAgIGcgPSBncm91cEJ5c1tjXTtcbiAgICAgICAgICAgICAgICB2YWx1ZSA9IHNvdXJjZS5nZXRWYWx1ZShnLCByKTtcblxuICAgICAgICAgICAgICAgIC8vdGVzdCB0aGF0IEknbSBub3QgYSBsZWFmXG4gICAgICAgICAgICAgICAgY3JlYXRlRnVuYyA9IChjID09PSBsZWFmRGVwdGgpID8gY3JlYXRlTGVhZiA6IGNyZWF0ZUJyYW5jaDtcbiAgICAgICAgICAgICAgICBwYXRoID0gcGF0aC5jaGlsZHJlbi5nZXRJZkFic2VudCh2YWx1ZSwgY3JlYXRlRnVuYyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBwYXRoLnJvd0luZGV4ZXMucHVzaChyKTtcbiAgICAgICAgICAgIHBhdGggPSB0cmVlO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuc29ydGVySW5zdGFuY2UgPSBuZXcgRGF0YVNvdXJjZVNvcnRlcihzb3VyY2UpO1xuICAgICAgICB0cmVlLnBydW5lKCk7XG4gICAgICAgIHRoaXMudHJlZS5jb21wdXRlQWdncmVnYXRlcyh0aGlzKTtcbiAgICAgICAgdGhpcy5idWlsZFZpZXcoKTtcbiAgICB9O1xuXG4gICAgRGF0YVNvdXJjZUFnZ3JlZ2F0b3IucHJvdG90eXBlLmJ1aWxkVmlldyA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy52aWV3Lmxlbmd0aCA9IDA7XG4gICAgICAgIHRoaXMudHJlZS5jb21wdXRlSGVpZ2h0KCk7XG4gICAgICAgIHRoaXMudHJlZS5idWlsZFZpZXcodGhpcyk7XG4gICAgfTtcblxuICAgIERhdGFTb3VyY2VBZ2dyZWdhdG9yLnByb3RvdHlwZS52aWV3TWFrZXNTZW5zZSA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuaGFzQWdncmVnYXRlcygpO1xuICAgIH07XG5cbiAgICBEYXRhU291cmNlQWdncmVnYXRvci5wcm90b3R5cGUuZ2V0VmFsdWUgPSBmdW5jdGlvbiAoeCwgeSkge1xuICAgICAgICBpZiAoIXRoaXMudmlld01ha2VzU2Vuc2UoKSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZGF0YVNvdXJjZS5nZXRWYWx1ZSh4LCB5KTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgcm93ID0gdGhpcy52aWV3W3ldO1xuICAgICAgICBpZiAoIXJvdykge1xuICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJvdy5nZXRWYWx1ZSh4KTtcbiAgICB9O1xuXG4gICAgRGF0YVNvdXJjZUFnZ3JlZ2F0b3IucHJvdG90eXBlLnNldFZhbHVlID0gZnVuY3Rpb24gKHgsIHksIHZhbHVlKSB7XG4gICAgICAgIGlmICghdGhpcy52aWV3TWFrZXNTZW5zZSgpKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5kYXRhU291cmNlLnNldFZhbHVlKHgsIHksIHZhbHVlKTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICBEYXRhU291cmNlQWdncmVnYXRvci5wcm90b3R5cGUuZ2V0Q29sdW1uQ291bnQgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmICghdGhpcy52aWV3TWFrZXNTZW5zZSgpKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5kYXRhU291cmNlLmdldENvbHVtbkNvdW50KCk7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGNvbENvdW50ID0gdGhpcy5nZXRIZWFkZXJzKCkubGVuZ3RoO1xuICAgICAgICByZXR1cm4gY29sQ291bnQ7XG4gICAgfTtcblxuICAgIERhdGFTb3VyY2VBZ2dyZWdhdG9yLnByb3RvdHlwZS5nZXRSb3dDb3VudCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKCF0aGlzLnZpZXdNYWtlc1NlbnNlKCkpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmRhdGFTb3VyY2UuZ2V0Um93Q291bnQoKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy52aWV3Lmxlbmd0aDsgLy9oZWFkZXIgY29sdW1uXG4gICAgfTtcblxuICAgIERhdGFTb3VyY2VBZ2dyZWdhdG9yLnByb3RvdHlwZS5jbGljayA9IGZ1bmN0aW9uICh5KSB7XG4gICAgICAgIHZhciBncm91cCA9IHRoaXMudmlld1t5XTtcbiAgICAgICAgZ3JvdXAudG9nZ2xlRXhwYW5zaW9uU3RhdGUodGhpcyk7XG4gICAgICAgIHRoaXMuYnVpbGRWaWV3KCk7XG4gICAgfTtcblxuICAgIERhdGFTb3VyY2VBZ2dyZWdhdG9yLnByb3RvdHlwZS5nZXRIZWFkZXJzID0gZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAoIXRoaXMudmlld01ha2VzU2Vuc2UoKSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZGF0YVNvdXJjZS5nZXRIZWFkZXJzKCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuaGVhZGVycztcbiAgICB9O1xuXG4gICAgRGF0YVNvdXJjZUFnZ3JlZ2F0b3IucHJvdG90eXBlLnNldEhlYWRlcnMgPSBmdW5jdGlvbiAoaGVhZGVycykge1xuICAgICAgICB0aGlzLmRhdGFTb3VyY2Uuc2V0SGVhZGVycyhoZWFkZXJzKTtcbiAgICB9O1xuXG4gICAgRGF0YVNvdXJjZUFnZ3JlZ2F0b3IucHJvdG90eXBlLmdldEZpZWxkcyA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGF0YVNvdXJjZS5nZXRGaWVsZHMoKTtcbiAgICB9O1xuXG4gICAgRGF0YVNvdXJjZUFnZ3JlZ2F0b3IucHJvdG90eXBlLnNldEZpZWxkcyA9IGZ1bmN0aW9uIChmaWVsZHMpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGF0YVNvdXJjZS5zZXRGaWVsZHMoZmllbGRzKTtcbiAgICB9O1xuXG4gICAgRGF0YVNvdXJjZUFnZ3JlZ2F0b3IucHJvdG90eXBlLmdldEdyYW5kVG90YWxzID0gZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgdmlldyA9IHRoaXMudHJlZTtcbiAgICAgICAgcmV0dXJuIFt2aWV3LmRhdGFdO1xuICAgIH07XG5cbiAgICBEYXRhU291cmNlQWdncmVnYXRvci5wcm90b3R5cGUuZ2V0Um93ID0gZnVuY3Rpb24gKHkpIHtcblxuICAgICAgICBpZiAoIXRoaXMudmlld01ha2VzU2Vuc2UoKSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZGF0YVNvdXJjZS5nZXRSb3coeSk7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgcm9sbHVwcyA9IHRoaXMudmlld1t5ICsgMV07XG4gICAgICAgIGlmICghcm9sbHVwcykge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMudHJlZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiByb2xsdXBzO1xuICAgIH07XG5cbiAgICBEYXRhU291cmNlQWdncmVnYXRvci5wcm90b3R5cGUuc2V0RGF0YSA9IGZ1bmN0aW9uIChhcnJheU9mVW5pZm9ybU9iamVjdHMpIHtcbiAgICAgICAgdGhpcy5kYXRhU291cmNlLnNldERhdGEoYXJyYXlPZlVuaWZvcm1PYmplY3RzKTtcbiAgICAgICAgdGhpcy5hcHBseSgpO1xuICAgIH07XG5cbiAgICByZXR1cm4gRGF0YVNvdXJjZUFnZ3JlZ2F0b3I7XG5cbn0pKCk7XG5cbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwib01mcEFuXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvRGF0YVNvdXJjZUFnZ3JlZ2F0b3IuanNcIixcIi9cIikiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG4ndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gKGZ1bmN0aW9uICgpIHtcblxuICAgIGZ1bmN0aW9uIERhdGFTb3VyY2VEZWNvcmF0b3IoZGF0YVNvdXJjZSkge1xuICAgICAgICB0aGlzLmRhdGFTb3VyY2UgPSBkYXRhU291cmNlO1xuICAgICAgICB0aGlzLmluZGV4ZXMgPSBbXTtcbiAgICB9XG5cbiAgICBEYXRhU291cmNlRGVjb3JhdG9yLnByb3RvdHlwZS5pc051bGxPYmplY3QgPSBmYWxzZTtcblxuICAgIERhdGFTb3VyY2VEZWNvcmF0b3IucHJvdG90eXBlLnRyYW5zcG9zZVkgPSBmdW5jdGlvbiAoeSkge1xuICAgICAgICBpZiAodGhpcy5pbmRleGVzLmxlbmd0aCAhPT0gMCkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuaW5kZXhlc1t5XTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4geTtcbiAgICB9O1xuXG4gICAgRGF0YVNvdXJjZURlY29yYXRvci5wcm90b3R5cGUuZ2V0VmFsdWUgPSBmdW5jdGlvbiAoeCwgeSkge1xuICAgICAgICB2YXIgdmFsdWUgPSB0aGlzLmRhdGFTb3VyY2UuZ2V0VmFsdWUoeCwgdGhpcy50cmFuc3Bvc2VZKHkpKTtcbiAgICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH07XG5cbiAgICBEYXRhU291cmNlRGVjb3JhdG9yLnByb3RvdHlwZS5nZXRSb3cgPSBmdW5jdGlvbiAoeSkge1xuXG4gICAgICAgIHJldHVybiB0aGlzLmRhdGFTb3VyY2UuZ2V0Um93KHRoaXMudHJhbnNwb3NlWSh5KSk7XG4gICAgfTtcblxuICAgIERhdGFTb3VyY2VEZWNvcmF0b3IucHJvdG90eXBlLnNldFZhbHVlID0gZnVuY3Rpb24gKHgsIHksIHZhbHVlKSB7XG5cbiAgICAgICAgdGhpcy5kYXRhU291cmNlLnNldFZhbHVlKHgsIHRoaXMudHJhbnNwb3NlWSh5KSwgdmFsdWUpO1xuICAgIH07XG5cbiAgICBEYXRhU291cmNlRGVjb3JhdG9yLnByb3RvdHlwZS5nZXRDb2x1bW5Db3VudCA9IGZ1bmN0aW9uICgpIHtcblxuICAgICAgICByZXR1cm4gdGhpcy5kYXRhU291cmNlLmdldENvbHVtbkNvdW50KCk7XG4gICAgfTtcblxuICAgIERhdGFTb3VyY2VEZWNvcmF0b3IucHJvdG90eXBlLmdldEZpZWxkcyA9IGZ1bmN0aW9uICgpIHtcblxuICAgICAgICByZXR1cm4gdGhpcy5kYXRhU291cmNlLmdldEZpZWxkcygpO1xuICAgIH07XG5cbiAgICBEYXRhU291cmNlRGVjb3JhdG9yLnByb3RvdHlwZS5zZXRGaWVsZHMgPSBmdW5jdGlvbiAoZmllbGRzKSB7XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuZGF0YVNvdXJjZS5zZXRGaWVsZHMoZmllbGRzKTtcbiAgICB9O1xuXG4gICAgRGF0YVNvdXJjZURlY29yYXRvci5wcm90b3R5cGUuZ2V0Um93Q291bnQgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmICh0aGlzLmluZGV4ZXMubGVuZ3RoICE9PSAwKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5pbmRleGVzLmxlbmd0aDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5kYXRhU291cmNlLmdldFJvd0NvdW50KCk7XG4gICAgfTtcblxuICAgIERhdGFTb3VyY2VEZWNvcmF0b3IucHJvdG90eXBlLnNldEhlYWRlcnMgPSBmdW5jdGlvbiAoaGVhZGVycykge1xuICAgICAgICByZXR1cm4gdGhpcy5kYXRhU291cmNlLnNldEhlYWRlcnMoaGVhZGVycyk7XG4gICAgfTtcblxuICAgIERhdGFTb3VyY2VEZWNvcmF0b3IucHJvdG90eXBlLmdldEhlYWRlcnMgPSBmdW5jdGlvbiAoKSB7XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuZGF0YVNvdXJjZS5nZXRIZWFkZXJzKCk7XG4gICAgfTtcblxuICAgIERhdGFTb3VyY2VEZWNvcmF0b3IucHJvdG90eXBlLmdldEdyYW5kVG90YWxzID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAvL25vdGhpbmcgaGVyZVxuICAgICAgICByZXR1cm47XG4gICAgfTtcblxuICAgIERhdGFTb3VyY2VEZWNvcmF0b3IucHJvdG90eXBlLmluaXRpYWxpemVJbmRleFZlY3RvciA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIHJvd0NvdW50ID0gdGhpcy5kYXRhU291cmNlLmdldFJvd0NvdW50KCk7XG4gICAgICAgIHZhciBpbmRleFZlY3RvciA9IG5ldyBBcnJheShyb3dDb3VudCk7XG4gICAgICAgIGZvciAodmFyIHIgPSAwOyByIDwgcm93Q291bnQ7IHIrKykge1xuICAgICAgICAgICAgaW5kZXhWZWN0b3Jbcl0gPSByO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuaW5kZXhlcyA9IGluZGV4VmVjdG9yO1xuICAgIH07XG5cbiAgICBEYXRhU291cmNlRGVjb3JhdG9yLnByb3RvdHlwZS5zZXREYXRhID0gZnVuY3Rpb24gKGFycmF5T2ZVbmlmb3JtT2JqZWN0cykge1xuICAgICAgICB0aGlzLmRhdGFTb3VyY2Uuc2V0RGF0YShhcnJheU9mVW5pZm9ybU9iamVjdHMpO1xuICAgIH07XG5cbiAgICByZXR1cm4gRGF0YVNvdXJjZURlY29yYXRvcjtcblxufSkoKTtcbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwib01mcEFuXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvRGF0YVNvdXJjZURlY29yYXRvci5qc1wiLFwiL1wiKSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbid1c2Ugc3RyaWN0JztcblxudmFyIERhdGFTb3VyY2VEZWNvcmF0b3IgPSByZXF1aXJlKCcuL0RhdGFTb3VyY2VEZWNvcmF0b3InKTtcblxubW9kdWxlLmV4cG9ydHMgPSAoZnVuY3Rpb24gKCkge1xuXG4gICAgZnVuY3Rpb24gRGF0YVNvdXJjZUZpbHRlcihkYXRhU291cmNlKSB7XG4gICAgICAgIERhdGFTb3VyY2VEZWNvcmF0b3IuY2FsbCh0aGlzLCBkYXRhU291cmNlLCBmYWxzZSk7XG4gICAgICAgIHRoaXMuZmlsdGVycyA9IFtdO1xuICAgIH1cblxuICAgIERhdGFTb3VyY2VGaWx0ZXIucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShEYXRhU291cmNlRGVjb3JhdG9yLnByb3RvdHlwZSk7XG5cbiAgICBEYXRhU291cmNlRmlsdGVyLnByb3RvdHlwZS5hZGRGaWx0ZXIgPSBmdW5jdGlvbiAoY29sdW1uSW5kZXgsIGZpbHRlcikge1xuICAgICAgICBmaWx0ZXIuY29sdW1uSW5kZXggPSBjb2x1bW5JbmRleDtcbiAgICAgICAgdGhpcy5maWx0ZXJzLnB1c2goZmlsdGVyKTtcbiAgICB9O1xuICAgIERhdGFTb3VyY2VGaWx0ZXIucHJvdG90eXBlLnNldEZpbHRlciA9IGZ1bmN0aW9uIChjb2x1bW5JbmRleCwgZmlsdGVyKSB7XG4gICAgICAgIGZpbHRlci5jb2x1bW5JbmRleCA9IGNvbHVtbkluZGV4O1xuICAgICAgICB0aGlzLmZpbHRlcnMucHVzaChmaWx0ZXIpO1xuICAgIH07XG5cbiAgICBEYXRhU291cmNlRmlsdGVyLnByb3RvdHlwZS5jbGVhckZpbHRlcnMgPSBmdW5jdGlvbiAoKSB7IC8qIGZpbHRlciAqL1xuICAgICAgICB0aGlzLmZpbHRlcnMubGVuZ3RoID0gMDtcbiAgICAgICAgdGhpcy5pbmRleGVzLmxlbmd0aCA9IDA7XG4gICAgfTtcblxuICAgIERhdGFTb3VyY2VGaWx0ZXIucHJvdG90eXBlLmFwcGx5RmlsdGVycyA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKHRoaXMuZmlsdGVycy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHRoaXMuaW5kZXhlcy5sZW5ndGggPSAwO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciBpbmRleGVzID0gdGhpcy5pbmRleGVzO1xuICAgICAgICBpbmRleGVzLmxlbmd0aCA9IDA7XG4gICAgICAgIHZhciBjb3VudCA9IHRoaXMuZGF0YVNvdXJjZS5nZXRSb3dDb3VudCgpO1xuICAgICAgICBmb3IgKHZhciByID0gMDsgciA8IGNvdW50OyByKyspIHtcbiAgICAgICAgICAgIGlmICh0aGlzLmFwcGx5RmlsdGVyc1RvKHIpKSB7XG4gICAgICAgICAgICAgICAgaW5kZXhlcy5wdXNoKHIpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfTtcblxuICAgIERhdGFTb3VyY2VGaWx0ZXIucHJvdG90eXBlLmFwcGx5RmlsdGVyc1RvID0gZnVuY3Rpb24gKHIpIHtcbiAgICAgICAgdmFyIGZpbHRlcnMgPSB0aGlzLmZpbHRlcnM7XG4gICAgICAgIHZhciBpc0ZpbHRlcmVkID0gdHJ1ZTtcbiAgICAgICAgZm9yICh2YXIgZiA9IDA7IGYgPCBmaWx0ZXJzLmxlbmd0aDsgZisrKSB7XG4gICAgICAgICAgICB2YXIgZmlsdGVyID0gZmlsdGVyc1tmXTtcbiAgICAgICAgICAgIHZhciByb3dPYmplY3QgPSB0aGlzLmRhdGFTb3VyY2UuZ2V0Um93KHIpO1xuICAgICAgICAgICAgaXNGaWx0ZXJlZCA9IGlzRmlsdGVyZWQgJiYgZmlsdGVyKHRoaXMuZGF0YVNvdXJjZS5nZXRWYWx1ZShmaWx0ZXIuY29sdW1uSW5kZXgsIHIpLCByb3dPYmplY3QsIHIpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBpc0ZpbHRlcmVkO1xuICAgIH07XG5cbiAgICByZXR1cm4gRGF0YVNvdXJjZUZpbHRlcjtcblxufSkoKTtcbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwib01mcEFuXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvRGF0YVNvdXJjZUZpbHRlci5qc1wiLFwiL1wiKSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbid1c2Ugc3RyaWN0JztcblxudmFyIERhdGFTb3VyY2VEZWNvcmF0b3IgPSByZXF1aXJlKCcuL0RhdGFTb3VyY2VEZWNvcmF0b3InKTtcblxubW9kdWxlLmV4cG9ydHMgPSAoZnVuY3Rpb24gKCkge1xuXG4gICAgZnVuY3Rpb24gRGF0YVNvdXJjZUdsb2JhbEZpbHRlcihkYXRhU291cmNlKSB7XG4gICAgICAgIERhdGFTb3VyY2VEZWNvcmF0b3IuY2FsbCh0aGlzLCBkYXRhU291cmNlLCBmYWxzZSk7XG4gICAgICAgIHRoaXMuZmlsdGVyID0gbnVsbDtcbiAgICB9XG5cbiAgICBEYXRhU291cmNlR2xvYmFsRmlsdGVyLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoRGF0YVNvdXJjZURlY29yYXRvci5wcm90b3R5cGUpO1xuXG4gICAgRGF0YVNvdXJjZUdsb2JhbEZpbHRlci5wcm90b3R5cGUuc2V0RmlsdGVyID0gZnVuY3Rpb24gKGZpbHRlcikge1xuICAgICAgICB0aGlzLmZpbHRlciA9IGZpbHRlcjtcbiAgICB9O1xuXG4gICAgRGF0YVNvdXJjZUdsb2JhbEZpbHRlci5wcm90b3R5cGUuY2xlYXJGaWx0ZXJzID0gZnVuY3Rpb24gKCkgeyAvKiBmaWx0ZXIgKi9cbiAgICAgICAgdGhpcy5maWx0ZXIgPSBudWxsO1xuICAgICAgICB0aGlzLmluZGV4ZXMubGVuZ3RoID0gMDtcbiAgICB9O1xuXG4gICAgRGF0YVNvdXJjZUdsb2JhbEZpbHRlci5wcm90b3R5cGUuYXBwbHlGaWx0ZXJzID0gZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAoIXRoaXMuZmlsdGVyKSB7XG4gICAgICAgICAgICB0aGlzLmluZGV4ZXMubGVuZ3RoID0gMDtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB2YXIgaW5kZXhlcyA9IHRoaXMuaW5kZXhlcztcbiAgICAgICAgaW5kZXhlcy5sZW5ndGggPSAwO1xuICAgICAgICB2YXIgY291bnQgPSB0aGlzLmRhdGFTb3VyY2UuZ2V0Um93Q291bnQoKTtcbiAgICAgICAgZm9yICh2YXIgciA9IDA7IHIgPCBjb3VudDsgcisrKSB7XG4gICAgICAgICAgICBpZiAodGhpcy5hcHBseUZpbHRlclRvKHIpKSB7XG4gICAgICAgICAgICAgICAgaW5kZXhlcy5wdXNoKHIpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfTtcblxuICAgIERhdGFTb3VyY2VHbG9iYWxGaWx0ZXIucHJvdG90eXBlLmFwcGx5RmlsdGVyVG8gPSBmdW5jdGlvbiAocikge1xuICAgICAgICB2YXIgaXNGaWx0ZXJlZCA9IGZhbHNlO1xuICAgICAgICB2YXIgZmlsdGVyID0gdGhpcy5maWx0ZXI7XG4gICAgICAgIHZhciBjb2xDb3VudCA9IHRoaXMuZ2V0Q29sdW1uQ291bnQoKTtcbiAgICAgICAgdmFyIHJvd09iamVjdCA9IHRoaXMuZGF0YVNvdXJjZS5nZXRSb3cocik7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgY29sQ291bnQ7IGkrKykge1xuICAgICAgICAgICAgaXNGaWx0ZXJlZCA9IGlzRmlsdGVyZWQgfHwgZmlsdGVyKHRoaXMuZGF0YVNvdXJjZS5nZXRWYWx1ZShpLCByKSwgcm93T2JqZWN0LCByKTtcbiAgICAgICAgICAgIGlmIChpc0ZpbHRlcmVkKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH07XG5cbiAgICByZXR1cm4gRGF0YVNvdXJjZUdsb2JhbEZpbHRlcjtcblxufSkoKTtcbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwib01mcEFuXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvRGF0YVNvdXJjZUdsb2JhbEZpbHRlci5qc1wiLFwiL1wiKSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbid1c2Ugc3RyaWN0JztcblxudmFyIFV0aWxzID0gcmVxdWlyZSgnLi9VdGlscy5qcycpO1xudmFyIERhdGFTb3VyY2VEZWNvcmF0b3IgPSByZXF1aXJlKCcuL0RhdGFTb3VyY2VEZWNvcmF0b3InKTtcblxubW9kdWxlLmV4cG9ydHMgPSAoZnVuY3Rpb24gKCkge1xuXG4gICAgZnVuY3Rpb24gRGF0YVNvdXJjZVNvcnRlcihkYXRhU291cmNlKSB7XG4gICAgICAgIERhdGFTb3VyY2VEZWNvcmF0b3IuY2FsbCh0aGlzLCBkYXRhU291cmNlKTtcbiAgICAgICAgdGhpcy5kZXNjZW5kaW5nU29ydCA9IGZhbHNlO1xuICAgIH1cblxuICAgIERhdGFTb3VyY2VTb3J0ZXIucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShEYXRhU291cmNlRGVjb3JhdG9yLnByb3RvdHlwZSk7XG5cbiAgICBEYXRhU291cmNlU29ydGVyLnByb3RvdHlwZS5zb3J0T24gPSBmdW5jdGlvbiAoY29sdW1uSW5kZXgsIHNvcnRUeXBlKSB7XG4gICAgICAgIGlmIChzb3J0VHlwZSA9PT0gMCkge1xuICAgICAgICAgICAgdGhpcy5pbmRleGVzLmxlbmd0aCA9IDA7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5pbml0aWFsaXplSW5kZXhWZWN0b3IoKTtcbiAgICAgICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgICAgICBVdGlscy5zdGFibGVTb3J0KHRoaXMuaW5kZXhlcywgZnVuY3Rpb24gKGluZGV4KSB7XG4gICAgICAgICAgICByZXR1cm4gc2VsZi5kYXRhU291cmNlLmdldFZhbHVlKGNvbHVtbkluZGV4LCBpbmRleCk7XG4gICAgICAgIH0sIHNvcnRUeXBlKTtcbiAgICB9O1xuXG4gICAgcmV0dXJuIERhdGFTb3VyY2VTb3J0ZXI7XG5cbn0pKCk7XG59KS5jYWxsKHRoaXMscmVxdWlyZShcIm9NZnBBblwiKSx0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiL0RhdGFTb3VyY2VTb3J0ZXIuanNcIixcIi9cIikiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG4ndXNlIHN0cmljdCc7XG5cbnZhciBEYXRhU291cmNlRGVjb3JhdG9yID0gcmVxdWlyZSgnLi9EYXRhU291cmNlRGVjb3JhdG9yJyk7XG52YXIgRGF0YVNvdXJjZVNvcnRlciA9IHJlcXVpcmUoJy4vRGF0YVNvdXJjZVNvcnRlcicpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IChmdW5jdGlvbiAoKSB7XG5cbiAgICBmdW5jdGlvbiBEYXRhU291cmNlU29ydGVyQ29tcG9zaXRlKGRhdGFTb3VyY2UpIHtcbiAgICAgICAgRGF0YVNvdXJjZURlY29yYXRvci5jYWxsKHRoaXMsIGRhdGFTb3VyY2UpO1xuICAgICAgICB0aGlzLnNvcnRzID0gW107XG4gICAgICAgIHRoaXMubGFzdCA9IHRoaXMuZGF0YVNvdXJjZTtcbiAgICB9XG5cbiAgICBEYXRhU291cmNlU29ydGVyQ29tcG9zaXRlLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoRGF0YVNvdXJjZURlY29yYXRvci5wcm90b3R5cGUpO1xuXG4gICAgRGF0YVNvdXJjZVNvcnRlckNvbXBvc2l0ZS5wcm90b3R5cGUuc29ydE9uID0gZnVuY3Rpb24gKGNvbHVtbkluZGV4LCBzb3J0VHlwZSkge1xuICAgICAgICB0aGlzLnNvcnRzLnB1c2goW2NvbHVtbkluZGV4LCBzb3J0VHlwZV0pO1xuICAgIH07XG5cbiAgICBEYXRhU291cmNlU29ydGVyQ29tcG9zaXRlLnByb3RvdHlwZS5hcHBseVNvcnRzID0gZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgc29ydHMgPSB0aGlzLnNvcnRzO1xuICAgICAgICB2YXIgZWFjaCA9IHRoaXMuZGF0YVNvdXJjZTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzb3J0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdmFyIHNvcnQgPSBzb3J0c1tpXTtcbiAgICAgICAgICAgIGVhY2ggPSBuZXcgRGF0YVNvdXJjZVNvcnRlcihlYWNoKTtcbiAgICAgICAgICAgIGVhY2guc29ydE9uKHNvcnRbMF0sIHNvcnRbMV0pO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMubGFzdCA9IGVhY2g7XG4gICAgfTtcblxuICAgIERhdGFTb3VyY2VTb3J0ZXJDb21wb3NpdGUucHJvdG90eXBlLmNsZWFyU29ydHMgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMuc29ydHMubGVuZ3RoID0gMDtcbiAgICAgICAgdGhpcy5sYXN0ID0gdGhpcy5kYXRhU291cmNlO1xuICAgIH07XG5cbiAgICBEYXRhU291cmNlU29ydGVyQ29tcG9zaXRlLnByb3RvdHlwZS5nZXRWYWx1ZSA9IGZ1bmN0aW9uICh4LCB5KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmxhc3QuZ2V0VmFsdWUoeCwgeSk7XG4gICAgfTtcblxuICAgIERhdGFTb3VyY2VTb3J0ZXJDb21wb3NpdGUucHJvdG90eXBlLnNldFZhbHVlID0gZnVuY3Rpb24gKHgsIHksIHZhbHVlKSB7XG4gICAgICAgIHRoaXMubGFzdC5zZXRWYWx1ZSh4LCB5LCB2YWx1ZSk7XG4gICAgfTtcblxuICAgIHJldHVybiBEYXRhU291cmNlU29ydGVyQ29tcG9zaXRlO1xuXG59KSgpO1xufSkuY2FsbCh0aGlzLHJlcXVpcmUoXCJvTWZwQW5cIiksdHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIgPyBzZWxmIDogdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHt9LHJlcXVpcmUoXCJidWZmZXJcIikuQnVmZmVyLGFyZ3VtZW50c1szXSxhcmd1bWVudHNbNF0sYXJndW1lbnRzWzVdLGFyZ3VtZW50c1s2XSxcIi9EYXRhU291cmNlU29ydGVyQ29tcG9zaXRlLmpzXCIsXCIvXCIpIiwiKGZ1bmN0aW9uIChwcm9jZXNzLGdsb2JhbCxCdWZmZXIsX19hcmd1bWVudDAsX19hcmd1bWVudDEsX19hcmd1bWVudDIsX19hcmd1bWVudDMsX19maWxlbmFtZSxfX2Rpcm5hbWUpe1xuJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IChmdW5jdGlvbiAoKSB7XG5cbiAgICB2YXIgaGVhZGVyaWZ5ID0gZnVuY3Rpb24gKHN0cmluZykge1xuICAgICAgICB2YXIgcGllY2VzID0gc3RyaW5nLnJlcGxhY2UoL1tfLV0vZywgJyAnKS5yZXBsYWNlKC9bQS1aXS9nLCAnICQmJykuc3BsaXQoJyAnKS5tYXAoZnVuY3Rpb24gKHMpIHtcbiAgICAgICAgICAgIHJldHVybiBzLmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpICsgcy5zbGljZSgxKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBwaWVjZXMuam9pbignICcpO1xuICAgIH07XG5cbiAgICB2YXIgY29tcHV0ZUZpZWxkTmFtZXMgPSBmdW5jdGlvbiAob2JqZWN0KSB7XG4gICAgICAgIGlmICghb2JqZWN0KSB7XG4gICAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGZpZWxkcyA9IFtdLmNvbmNhdChPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhvYmplY3QpLmZpbHRlcihmdW5jdGlvbiAoZSkge1xuICAgICAgICAgICAgcmV0dXJuIGUuc3Vic3RyKDAsIDIpICE9PSAnX18nO1xuICAgICAgICB9KSk7XG4gICAgICAgIHJldHVybiBmaWVsZHM7XG4gICAgfTtcblxuICAgIGZ1bmN0aW9uIEpTRGF0YVNvdXJjZShkYXRhLCBmaWVsZHMpIHtcbiAgICAgICAgdGhpcy5maWVsZHMgPSBmaWVsZHMgfHwgY29tcHV0ZUZpZWxkTmFtZXMoZGF0YVswXSk7XG4gICAgICAgIHRoaXMuaGVhZGVycyA9IFtdO1xuICAgICAgICB0aGlzLmRhdGEgPSBkYXRhO1xuICAgIH1cblxuICAgIEpTRGF0YVNvdXJjZS5wcm90b3R5cGUuaXNOdWxsT2JqZWN0ID0gZmFsc2U7XG5cbiAgICBKU0RhdGFTb3VyY2UucHJvdG90eXBlLmdldFZhbHVlID0gZnVuY3Rpb24gKHgsIHkpIHtcbiAgICAgICAgdmFyIHJvdyA9IHRoaXMuZGF0YVt5XTtcbiAgICAgICAgaWYgKCFyb3cpIHtcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgICAgIHZhciB2YWx1ZSA9IHJvd1t0aGlzLmZpZWxkc1t4XV07XG4gICAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9O1xuXG4gICAgSlNEYXRhU291cmNlLnByb3RvdHlwZS5nZXRSb3cgPSBmdW5jdGlvbiAoeSkge1xuXG4gICAgICAgIHJldHVybiB0aGlzLmRhdGFbeV07XG4gICAgfTtcblxuICAgIEpTRGF0YVNvdXJjZS5wcm90b3R5cGUuc2V0VmFsdWUgPSBmdW5jdGlvbiAoeCwgeSwgdmFsdWUpIHtcblxuICAgICAgICB0aGlzLmRhdGFbeV1bdGhpcy5maWVsZHNbeF1dID0gdmFsdWU7XG4gICAgfTtcblxuICAgIEpTRGF0YVNvdXJjZS5wcm90b3R5cGUuZ2V0Q29sdW1uQ291bnQgPSBmdW5jdGlvbiAoKSB7XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0RmllbGRzKCkubGVuZ3RoO1xuICAgIH07XG5cbiAgICBKU0RhdGFTb3VyY2UucHJvdG90eXBlLmdldFJvd0NvdW50ID0gZnVuY3Rpb24gKCkge1xuXG4gICAgICAgIHJldHVybiB0aGlzLmRhdGEubGVuZ3RoO1xuICAgIH07XG5cbiAgICBKU0RhdGFTb3VyY2UucHJvdG90eXBlLmdldEZpZWxkcyA9IGZ1bmN0aW9uICgpIHtcblxuICAgICAgICByZXR1cm4gdGhpcy5maWVsZHM7XG4gICAgfTtcblxuICAgIEpTRGF0YVNvdXJjZS5wcm90b3R5cGUuZ2V0SGVhZGVycyA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKCF0aGlzLmhlYWRlcnMgfHwgdGhpcy5oZWFkZXJzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgdGhpcy5oZWFkZXJzID0gdGhpcy5nZXREZWZhdWx0SGVhZGVycygpLm1hcChmdW5jdGlvbiAoZWFjaCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBoZWFkZXJpZnkoZWFjaCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5oZWFkZXJzO1xuICAgIH07XG5cbiAgICBKU0RhdGFTb3VyY2UucHJvdG90eXBlLmdldERlZmF1bHRIZWFkZXJzID0gZnVuY3Rpb24gKCkge1xuXG4gICAgICAgIHJldHVybiB0aGlzLmdldEZpZWxkcygpO1xuICAgIH07XG5cbiAgICBKU0RhdGFTb3VyY2UucHJvdG90eXBlLnNldEZpZWxkcyA9IGZ1bmN0aW9uIChmaWVsZHMpIHtcblxuICAgICAgICB0aGlzLmZpZWxkcyA9IGZpZWxkcztcbiAgICB9O1xuXG4gICAgSlNEYXRhU291cmNlLnByb3RvdHlwZS5zZXRIZWFkZXJzID0gZnVuY3Rpb24gKGhlYWRlcnMpIHtcblxuICAgICAgICB0aGlzLmhlYWRlcnMgPSBoZWFkZXJzO1xuICAgIH07XG5cbiAgICBKU0RhdGFTb3VyY2UucHJvdG90eXBlLmdldEdyYW5kVG90YWxzID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAvL25vdGhpbmcgaGVyZVxuICAgICAgICByZXR1cm47XG4gICAgfTtcblxuICAgIEpTRGF0YVNvdXJjZS5wcm90b3R5cGUuc2V0RGF0YSA9IGZ1bmN0aW9uIChhcnJheU9mVW5pZm9ybU9iamVjdHMpIHtcbiAgICAgICAgdGhpcy5kYXRhID0gYXJyYXlPZlVuaWZvcm1PYmplY3RzO1xuICAgIH07XG5cbiAgICByZXR1cm4gSlNEYXRhU291cmNlO1xuXG59KSgpO1xuXG59KS5jYWxsKHRoaXMscmVxdWlyZShcIm9NZnBBblwiKSx0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiL0pTRGF0YVNvdXJjZS5qc1wiLFwiL1wiKSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSAoZnVuY3Rpb24gKCkge1xuXG4gICAgdmFyIG9pZFByZWZpeCA9ICcufi4jJV8nOyAvL3RoaXMgc2hvdWxkIGJlIHNvbWV0aGluZyB3ZSBuZXZlciB3aWxsIHNlZSBhdCB0aGUgYmVnaW5pbmcgb2YgYSBzdHJpbmdcbiAgICB2YXIgY291bnRlciA9IDA7XG5cbiAgICB2YXIgaGFzaCA9IGZ1bmN0aW9uIChrZXkpIHtcbiAgICAgICAgdmFyIHR5cGVPZiA9IHR5cGVvZiBrZXk7XG4gICAgICAgIHN3aXRjaCAodHlwZU9mKSB7XG4gICAgICAgIGNhc2UgJ251bWJlcic6XG4gICAgICAgICAgICByZXR1cm4gb2lkUHJlZml4ICsgdHlwZU9mICsgJ18nICsga2V5O1xuICAgICAgICBjYXNlICdzdHJpbmcnOlxuICAgICAgICAgICAgcmV0dXJuIG9pZFByZWZpeCArIHR5cGVPZiArICdfJyArIGtleTtcbiAgICAgICAgY2FzZSAnYm9vbGVhbic6XG4gICAgICAgICAgICByZXR1cm4gb2lkUHJlZml4ICsgdHlwZU9mICsgJ18nICsga2V5O1xuICAgICAgICBjYXNlICdzeW1ib2wnOlxuICAgICAgICAgICAgcmV0dXJuIG9pZFByZWZpeCArIHR5cGVPZiArICdfJyArIGtleTtcbiAgICAgICAgY2FzZSAndW5kZWZpbmVkJzpcbiAgICAgICAgICAgIHJldHVybiBvaWRQcmVmaXggKyAndW5kZWZpbmVkJztcbiAgICAgICAgY2FzZSAnb2JqZWN0JzpcbiAgICAgICAgICAgIC8qZXNsaW50LWRpc2FibGUgKi9cbiAgICAgICAgICAgIGlmIChrZXkuX19fZmluaGFzaCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBrZXkuX19fZmluaGFzaDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGtleS5fX19maW5oYXNoID0gb2lkUHJlZml4ICsgY291bnRlcisrO1xuICAgICAgICAgICAgcmV0dXJuIGtleS5fX19maW5oYXNoO1xuICAgICAgICBjYXNlICdmdW5jdGlvbic6XG4gICAgICAgICAgICBpZiAoa2V5Ll9fX2Zpbmhhc2gpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4ga2V5Ll9fX2Zpbmhhc2g7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBrZXkuX19fZmluaGFzaCA9IG9pZFByZWZpeCArIGNvdW50ZXIrKztcbiAgICAgICAgICAgIHJldHVybiBrZXkuX19fZmluaGFzaDsgLyplc2xpbnQtZW5hYmxlICovXG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgLy8gT2JqZWN0LmlzIHBvbHlmaWxsLCBjb3VydGVzeSBvZiBAV2ViUmVmbGVjdGlvblxuICAgIHZhciBpcyA9IE9iamVjdC5pcyB8fFxuICAgIGZ1bmN0aW9uIChhLCBiKSB7XG4gICAgICAgIHJldHVybiBhID09PSBiID8gYSAhPT0gMCB8fCAxIC8gYSA9PSAxIC8gYiA6IGEgIT0gYSAmJiBiICE9IGI7IC8vIGVzbGludC1kaXNhYmxlLWxpbmVcbiAgICB9O1xuXG4gICAgLy8gTW9yZSByZWxpYWJsZSBpbmRleE9mLCBjb3VydGVzeSBvZiBAV2ViUmVmbGVjdGlvblxuICAgIHZhciBiZXR0ZXJJbmRleE9mID0gZnVuY3Rpb24gKGFyciwgdmFsdWUpIHtcbiAgICAgICAgaWYgKHZhbHVlICE9IHZhbHVlIHx8IHZhbHVlID09PSAwKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmVcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSBhcnIubGVuZ3RoOyBpLS0gJiYgIWlzKGFycltpXSwgdmFsdWUpOykgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lXG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpID0gW10uaW5kZXhPZi5jYWxsKGFyciwgdmFsdWUpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBpO1xuICAgIH07XG5cbiAgICBmdW5jdGlvbiBNYXBweSgpIHtcbiAgICAgICAgdGhpcy5rZXlzID0gW107XG4gICAgICAgIHRoaXMuZGF0YSA9IHt9O1xuICAgICAgICB0aGlzLnZhbHVlcyA9IFtdO1xuICAgIH1cblxuICAgIE1hcHB5LnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbiAoa2V5LCB2YWx1ZSkge1xuICAgICAgICB2YXIgaGFzaENvZGUgPSBoYXNoKGtleSk7XG4gICAgICAgIGlmICh0aGlzLmRhdGFbaGFzaENvZGVdID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHRoaXMua2V5cy5wdXNoKGtleSk7XG4gICAgICAgICAgICB0aGlzLnZhbHVlcy5wdXNoKHZhbHVlKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmRhdGFbaGFzaENvZGVdID0gdmFsdWU7XG4gICAgfTtcblxuICAgIE1hcHB5LnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbiAoa2V5KSB7XG4gICAgICAgIHZhciBoYXNoQ29kZSA9IGhhc2goa2V5KTtcbiAgICAgICAgcmV0dXJuIHRoaXMuZGF0YVtoYXNoQ29kZV07XG4gICAgfTtcblxuICAgIE1hcHB5LnByb3RvdHlwZS5nZXRJZkFic2VudCA9IGZ1bmN0aW9uIChrZXksIGlmQWJzZW50RnVuYykge1xuICAgICAgICB2YXIgdmFsdWUgPSB0aGlzLmdldChrZXkpO1xuICAgICAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgdmFsdWUgPSBpZkFic2VudEZ1bmMoa2V5LCB0aGlzKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgfTtcblxuICAgIE1hcHB5LnByb3RvdHlwZS5zaXplID0gZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5rZXlzLmxlbmd0aDtcbiAgICB9O1xuXG4gICAgTWFwcHkucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLmtleXMubGVuZ3RoID0gMDtcbiAgICAgICAgdGhpcy5kYXRhID0ge307XG4gICAgfTtcblxuICAgIE1hcHB5LnByb3RvdHlwZS5kZWxldGUgPSBmdW5jdGlvbiAoa2V5KSB7XG4gICAgICAgIHZhciBoYXNoQ29kZSA9IGhhc2goa2V5KTtcbiAgICAgICAgaWYgKHRoaXMuZGF0YVtoYXNoQ29kZV0gPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciBpbmRleCA9IGJldHRlckluZGV4T2YodGhpcy5rZXlzLCBrZXkpO1xuICAgICAgICB0aGlzLmtleXMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgdGhpcy52YWx1ZXMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgZGVsZXRlIHRoaXMuZGF0YVtoYXNoQ29kZV07XG4gICAgfTtcblxuICAgIE1hcHB5LnByb3RvdHlwZS5mb3JFYWNoID0gZnVuY3Rpb24gKGZ1bmMpIHtcbiAgICAgICAgdmFyIGtleXMgPSB0aGlzLmtleXM7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwga2V5cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdmFyIGtleSA9IGtleXNbaV07XG4gICAgICAgICAgICB2YXIgdmFsdWUgPSB0aGlzLmdldChrZXkpO1xuICAgICAgICAgICAgZnVuYyh2YWx1ZSwga2V5LCB0aGlzKTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICBNYXBweS5wcm90b3R5cGUubWFwID0gZnVuY3Rpb24gKGZ1bmMpIHtcbiAgICAgICAgdmFyIGtleXMgPSB0aGlzLmtleXM7XG4gICAgICAgIHZhciBuZXdNYXAgPSBuZXcgTWFwcHkoKTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBrZXlzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICB2YXIga2V5ID0ga2V5c1tpXTtcbiAgICAgICAgICAgIHZhciB2YWx1ZSA9IHRoaXMuZ2V0KGtleSk7XG4gICAgICAgICAgICB2YXIgdHJhbnNmb3JtZWQgPSBmdW5jKHZhbHVlLCBrZXksIHRoaXMpO1xuICAgICAgICAgICAgbmV3TWFwLnNldChrZXksIHRyYW5zZm9ybWVkKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbmV3TWFwO1xuICAgIH07XG5cbiAgICBNYXBweS5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIGtleXMgPSB0aGlzLmtleXM7XG4gICAgICAgIHZhciBuZXdNYXAgPSBuZXcgTWFwcHkoKTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBrZXlzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICB2YXIga2V5ID0ga2V5c1tpXTtcbiAgICAgICAgICAgIHZhciB2YWx1ZSA9IHRoaXMuZ2V0KGtleSk7XG4gICAgICAgICAgICBuZXdNYXAuc2V0KGtleSwgdmFsdWUpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBuZXdNYXA7XG4gICAgfTtcblxuICAgIHJldHVybiBNYXBweTtcblxufSkoKTtcbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwib01mcEFuXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvTWFwLmpzXCIsXCIvXCIpIiwiKGZ1bmN0aW9uIChwcm9jZXNzLGdsb2JhbCxCdWZmZXIsX19hcmd1bWVudDAsX19hcmd1bWVudDEsX19hcmd1bWVudDIsX19hcmd1bWVudDMsX19maWxlbmFtZSxfX2Rpcm5hbWUpe1xuJ3VzZSBzdHJpY3QnO1xuXG52YXIgc3RhYmxlU29ydCA9IHJlcXVpcmUoJy4vc3RhYmxlU29ydC5qcycpO1xudmFyIE1hcCA9IHJlcXVpcmUoJy4vTWFwLmpzJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gKGZ1bmN0aW9uICgpIHtcblxuICAgIHJldHVybiB7XG4gICAgICAgIHN0YWJsZVNvcnQ6IHN0YWJsZVNvcnQsXG4gICAgICAgIE1hcDogTWFwXG4gICAgfTtcblxufSkoKTtcbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwib01mcEFuXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvVXRpbHMuanNcIixcIi9cIikiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG4ndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gKGZ1bmN0aW9uICgpIHtcblxuICAgIHJldHVybiB7XG5cbiAgICAgICAgY291bnQ6IGZ1bmN0aW9uICgpIHsgLyogY29sdW1JbmRleCAqL1xuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIChncm91cCkge1xuICAgICAgICAgICAgICAgIHZhciByb3dzID0gZ3JvdXAuZ2V0Um93Q291bnQoKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gcm93cztcbiAgICAgICAgICAgIH07XG4gICAgICAgIH0sXG5cbiAgICAgICAgc3VtOiBmdW5jdGlvbiAoY29sdW1JbmRleCkge1xuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIChncm91cCkge1xuICAgICAgICAgICAgICAgIHZhciBzdW0gPSAwO1xuICAgICAgICAgICAgICAgIHZhciByb3dzID0gZ3JvdXAuZ2V0Um93Q291bnQoKTtcbiAgICAgICAgICAgICAgICBmb3IgKHZhciByID0gMDsgciA8IHJvd3M7IHIrKykge1xuICAgICAgICAgICAgICAgICAgICBzdW0gPSBzdW0gKyBncm91cC5nZXRWYWx1ZShjb2x1bUluZGV4LCByKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIHN1bTtcbiAgICAgICAgICAgIH07XG4gICAgICAgIH0sXG5cbiAgICAgICAgbWluOiBmdW5jdGlvbiAoY29sdW1JbmRleCkge1xuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIChncm91cCkge1xuICAgICAgICAgICAgICAgIHZhciBtaW4gPSAwO1xuICAgICAgICAgICAgICAgIHZhciByb3dzID0gZ3JvdXAuZ2V0Um93Q291bnQoKTtcbiAgICAgICAgICAgICAgICBmb3IgKHZhciByID0gMDsgciA8IHJvd3M7IHIrKykge1xuICAgICAgICAgICAgICAgICAgICBtaW4gPSBNYXRoLm1pbihtaW4sIGdyb3VwLmdldFZhbHVlKGNvbHVtSW5kZXgsIHIpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIG1pbjtcbiAgICAgICAgICAgIH07XG4gICAgICAgIH0sXG5cblxuICAgICAgICBtYXg6IGZ1bmN0aW9uIChjb2x1bUluZGV4KSB7XG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKGdyb3VwKSB7XG4gICAgICAgICAgICAgICAgdmFyIG1heCA9IDA7XG4gICAgICAgICAgICAgICAgdmFyIHJvd3MgPSBncm91cC5nZXRSb3dDb3VudCgpO1xuICAgICAgICAgICAgICAgIGZvciAodmFyIHIgPSAwOyByIDwgcm93czsgcisrKSB7XG4gICAgICAgICAgICAgICAgICAgIG1heCA9IE1hdGgubWF4KG1heCwgZ3JvdXAuZ2V0VmFsdWUoY29sdW1JbmRleCwgcikpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gbWF4O1xuICAgICAgICAgICAgfTtcbiAgICAgICAgfSxcblxuICAgICAgICBhdmc6IGZ1bmN0aW9uIChjb2x1bUluZGV4KSB7XG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKGdyb3VwKSB7XG4gICAgICAgICAgICAgICAgdmFyIHN1bSA9IDA7XG4gICAgICAgICAgICAgICAgdmFyIHJvd3MgPSBncm91cC5nZXRSb3dDb3VudCgpO1xuICAgICAgICAgICAgICAgIGZvciAodmFyIHIgPSAwOyByIDwgcm93czsgcisrKSB7XG4gICAgICAgICAgICAgICAgICAgIHN1bSA9IHN1bSArIGdyb3VwLmdldFZhbHVlKGNvbHVtSW5kZXgsIHIpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gc3VtIC8gcm93cztcbiAgICAgICAgICAgIH07XG4gICAgICAgIH0sXG5cbiAgICAgICAgZmlyc3Q6IGZ1bmN0aW9uIChjb2x1bUluZGV4KSB7XG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKGdyb3VwKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGdyb3VwLmdldFZhbHVlKGNvbHVtSW5kZXgsIDApO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgfSxcblxuICAgICAgICBsYXN0OiBmdW5jdGlvbiAoY29sdW1JbmRleCkge1xuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIChncm91cCkge1xuICAgICAgICAgICAgICAgIHZhciByb3dzID0gZ3JvdXAuZ2V0Um93Q291bnQoKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gZ3JvdXAuZ2V0VmFsdWUoY29sdW1JbmRleCwgcm93cyAtIDEpO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgfSxcblxuICAgICAgICBzdGRkZXY6IGZ1bmN0aW9uIChjb2x1bUluZGV4KSB7XG4gICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24gKGdyb3VwKSB7XG4gICAgICAgICAgICAgICAgdmFyIHI7XG4gICAgICAgICAgICAgICAgdmFyIHN1bSA9IDA7XG4gICAgICAgICAgICAgICAgdmFyIHJvd3MgPSBncm91cC5nZXRSb3dDb3VudCgpO1xuICAgICAgICAgICAgICAgIGZvciAociA9IDA7IHIgPCByb3dzOyByKyspIHtcbiAgICAgICAgICAgICAgICAgICAgc3VtID0gc3VtICsgZ3JvdXAuZ2V0VmFsdWUoY29sdW1JbmRleCwgcik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHZhciBtZWFuID0gc3VtIC8gcm93cztcbiAgICAgICAgICAgICAgICB2YXIgdmFyaWFuY2UgPSAwO1xuICAgICAgICAgICAgICAgIGZvciAociA9IDA7IHIgPCByb3dzOyByKyspIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGRldiA9IChncm91cC5nZXRWYWx1ZShjb2x1bUluZGV4LCByKSAtIG1lYW4pO1xuICAgICAgICAgICAgICAgICAgICB2YXJpYW5jZSA9IHZhcmlhbmNlICsgKGRldiAqIGRldik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHZhciBzdGRkZXYgPSBNYXRoLnNxcnQodmFyaWFuY2UgLyByb3dzKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gc3RkZGV2O1xuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgIH07XG5cbn0pKCk7XG59KS5jYWxsKHRoaXMscmVxdWlyZShcIm9NZnBBblwiKSx0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiL2FnZ3JlZ2F0aW9ucy5qc1wiLFwiL1wiKSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbid1c2Ugc3RyaWN0JztcblxudmFyIEpTRGF0YVNvdXJjZSA9IHJlcXVpcmUoJy4vSlNEYXRhU291cmNlJyk7XG52YXIgRGF0YVNvdXJjZVNvcnRlciA9IHJlcXVpcmUoJy4vRGF0YVNvdXJjZVNvcnRlcicpO1xudmFyIERhdGFTb3VyY2VTb3J0ZXJDb21wb3NpdGUgPSByZXF1aXJlKCcuL0RhdGFTb3VyY2VTb3J0ZXJDb21wb3NpdGUnKTtcbnZhciBEYXRhU291cmNlRmlsdGVyID0gcmVxdWlyZSgnLi9EYXRhU291cmNlRmlsdGVyJyk7XG52YXIgRGF0YVNvdXJjZUdsb2JhbEZpbHRlciA9IHJlcXVpcmUoJy4vRGF0YVNvdXJjZUdsb2JhbEZpbHRlcicpO1xudmFyIERhdGFTb3VyY2VBZ2dyZWdhdG9yID0gcmVxdWlyZSgnLi9EYXRhU291cmNlQWdncmVnYXRvcicpO1xudmFyIGFnZ3JlZ2F0aW9ucyA9IHJlcXVpcmUoJy4vYWdncmVnYXRpb25zJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gKGZ1bmN0aW9uICgpIHtcblxuICAgIHJldHVybiB7XG4gICAgICAgIEpTRGF0YVNvdXJjZTogSlNEYXRhU291cmNlLFxuICAgICAgICBEYXRhU291cmNlU29ydGVyOiBEYXRhU291cmNlU29ydGVyLFxuICAgICAgICBEYXRhU291cmNlU29ydGVyQ29tcG9zaXRlOiBEYXRhU291cmNlU29ydGVyQ29tcG9zaXRlLFxuICAgICAgICBEYXRhU291cmNlRmlsdGVyOiBEYXRhU291cmNlRmlsdGVyLFxuICAgICAgICBEYXRhU291cmNlR2xvYmFsRmlsdGVyOiBEYXRhU291cmNlR2xvYmFsRmlsdGVyLFxuICAgICAgICBEYXRhU291cmNlQWdncmVnYXRvcjogRGF0YVNvdXJjZUFnZ3JlZ2F0b3IsXG4gICAgICAgIGFnZ3JlZ2F0aW9uczogYWdncmVnYXRpb25zXG4gICAgfTtcblxufSkoKTtcbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwib01mcEFuXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvYW5hbHl0aWNzLmpzXCIsXCIvXCIpIiwiKGZ1bmN0aW9uIChwcm9jZXNzLGdsb2JhbCxCdWZmZXIsX19hcmd1bWVudDAsX19hcmd1bWVudDEsX19hcmd1bWVudDIsX19hcmd1bWVudDMsX19maWxlbmFtZSxfX2Rpcm5hbWUpe1xuLyogZXNsaW50LWVudiBub2RlLCBicm93c2VyICovXG4ndXNlIHN0cmljdCc7XG5cbnZhciBub29wID0gZnVuY3Rpb24gKCkge307XG5cbnZhciBvbyA9IHJlcXVpcmUoJ29iamVjdC5vYnNlcnZlJyk7XG52YXIgYW5hbHl0aWNzID0gcmVxdWlyZSgnLi9hbmFseXRpY3MuanMnKTtcblxubm9vcChvbyk7XG5cbmlmICghd2luZG93LmZpbikge1xuICAgIHdpbmRvdy5maW4gPSB7fTtcbn1cbmlmICghd2luZG93LmZpbi5hbmFseXRpY3MpIHtcbiAgICB3aW5kb3cuZmluLmFuYWx5dGljcyA9IGFuYWx5dGljcztcbn1cbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwib01mcEFuXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvZmFrZV8xYTMyYTY4YS5qc1wiLFwiL1wiKSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbid1c2Ugc3RyaWN0JztcblxudmFyIHN0YWJpbGl6ZSA9IGZ1bmN0aW9uIChjb21wYXJhdG9yLCBkZXNjZW5kaW5nKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uIChhcnIxLCBhcnIyKSB7XG4gICAgICAgIHZhciB4ID0gYXJyMVswXTtcbiAgICAgICAgdmFyIHkgPSBhcnIyWzBdO1xuICAgICAgICBpZiAoeCA9PT0geSkge1xuICAgICAgICAgICAgeCA9IGRlc2NlbmRpbmcgPyBhcnIyWzFdIDogYXJyMVsxXTtcbiAgICAgICAgICAgIHkgPSBkZXNjZW5kaW5nID8gYXJyMVsxXSA6IGFycjJbMV07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpZiAoeSA9PT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIHJldHVybiAtMTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICh4ID09PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIDE7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGNvbXBhcmF0b3IoeCwgeSk7XG4gICAgfTtcbn07XG5cblxudmFyIGFzY2VuZGluZ051bWJlcnMgPSBmdW5jdGlvbiAoeCwgeSkge1xuICAgIHJldHVybiB4IC0geTtcbn07XG5cbnZhciBkZXNjZW5kaW5nTnVtYmVycyA9IGZ1bmN0aW9uICh4LCB5KSB7XG4gICAgcmV0dXJuIHkgLSB4O1xufTtcblxudmFyIGFzY2VuZGluZ0FsbE90aGVycyA9IGZ1bmN0aW9uICh4LCB5KSB7XG4gICAgcmV0dXJuIHggPCB5ID8gLTEgOiAxO1xufTtcblxudmFyIGRlc2NlbmRpbmdBbGxPdGhlcnMgPSBmdW5jdGlvbiAoeCwgeSkge1xuICAgIHJldHVybiB5IDwgeCA/IC0xIDogMTtcbn07XG5cbnZhciBhc2NlbmRpbmcgPSBmdW5jdGlvbiAodHlwZU9mRGF0YSkge1xuICAgIGlmICh0eXBlT2ZEYXRhID09PSAnbnVtYmVyJykge1xuICAgICAgICByZXR1cm4gc3RhYmlsaXplKGFzY2VuZGluZ051bWJlcnMsIGZhbHNlKTtcbiAgICB9XG4gICAgcmV0dXJuIHN0YWJpbGl6ZShhc2NlbmRpbmdBbGxPdGhlcnMsIGZhbHNlKTtcbn07XG5cbnZhciBkZXNjZW5kaW5nID0gZnVuY3Rpb24gKHR5cGVPZkRhdGEpIHtcbiAgICBpZiAodHlwZU9mRGF0YSA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgcmV0dXJuIHN0YWJpbGl6ZShkZXNjZW5kaW5nTnVtYmVycywgdHJ1ZSk7XG4gICAgfVxuICAgIHJldHVybiBzdGFiaWxpemUoZGVzY2VuZGluZ0FsbE90aGVycywgdHJ1ZSk7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IChmdW5jdGlvbiAoKSB7XG5cbiAgICBmdW5jdGlvbiBzb3J0KGluZGV4VmVjdG9yLCBkYXRhU291cmNlLCBzb3J0VHlwZSkge1xuXG4gICAgICAgIHZhciBjb21wYXJlLCBpO1xuXG4gICAgICAgIGlmIChpbmRleFZlY3Rvci5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybjsgLy9ub3RoaW5nIHRvIGRvO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHNvcnRUeXBlID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHNvcnRUeXBlID0gMTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChzb3J0VHlwZSA9PT0gMCkge1xuICAgICAgICAgICAgcmV0dXJuOyAvLyBub3RoaW5nIHRvIHNvcnQgaGVyZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciB0eXBlT2ZEYXRhID0gdHlwZW9mIGRhdGFTb3VyY2UoMCk7XG5cbiAgICAgICAgY29tcGFyZSA9IChzb3J0VHlwZSA9PT0gMSkgPyBhc2NlbmRpbmcodHlwZU9mRGF0YSkgOiBkZXNjZW5kaW5nKHR5cGVPZkRhdGEpO1xuXG4gICAgICAgIC8vc3RhcnQgdGhlIGFjdHVhbGx5IHNvcnRpbmcuLi4uLlxuICAgICAgICB2YXIgdG1wID0gbmV3IEFycmF5KGluZGV4VmVjdG9yLmxlbmd0aCk7XG5cbiAgICAgICAgLy9sZXRzIGFkZCB0aGUgaW5kZXggZm9yIHN0YWJpbGl0eVxuICAgICAgICBmb3IgKGkgPSAwOyBpIDwgaW5kZXhWZWN0b3IubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHRtcFtpXSA9IFtkYXRhU291cmNlKGkpLCBpXTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRtcC5zb3J0KGNvbXBhcmUpO1xuXG4gICAgICAgIC8vY29weSB0aGUgc29ydGVkIHZhbHVlcyBpbnRvIG91ciBpbmRleCB2ZWN0b3JcbiAgICAgICAgZm9yIChpID0gMDsgaSA8IGluZGV4VmVjdG9yLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBpbmRleFZlY3RvcltpXSA9IHRtcFtpXVsxXTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBzb3J0O1xufSkoKTtcbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwib01mcEFuXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvc3RhYmxlU29ydC5qc1wiLFwiL1wiKSJdfQ==
