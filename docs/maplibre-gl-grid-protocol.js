var GridProtocol = (function (exports) {
    'use strict';

    var SHIFT_LEFT_32 = (1 << 16) * (1 << 16);
    var SHIFT_RIGHT_32 = 1 / SHIFT_LEFT_32;

    // Threshold chosen based on both benchmarking and knowledge about browser string
    // data structures (which currently switch structure types at 12 bytes or more)
    var TEXT_DECODER_MIN_LENGTH = 12;
    var utf8TextDecoder = typeof TextDecoder === 'undefined' ? null : new TextDecoder('utf-8');

    var PBF_VARINT  = 0; // varint: int32, int64, uint32, uint64, sint32, sint64, bool, enum
    var PBF_FIXED64 = 1; // 64-bit: double, fixed64, sfixed64
    var PBF_BYTES   = 2; // length-delimited: string, bytes, embedded messages, packed repeated fields
    var PBF_FIXED32 = 5; // 32-bit: float, fixed32, sfixed32

    var Pbf = function Pbf(buf) {
        if ( buf === void 0 ) buf = new Uint8Array(16);

        this.buf = ArrayBuffer.isView(buf) ? buf : new Uint8Array(buf);
        this.dataView = new DataView(this.buf.buffer);
        this.pos = 0;
        this.type = 0;
        this.length = this.buf.length;
    };

    // === READING =================================================================

    /**
     * @template T
     * @param {(tag: number, result: T, pbf: Pbf) => void} readField
     * @param {T} result
     * @param {number} [end]
     */
    Pbf.prototype.readFields = function readFields (readField, result, end) {
            if ( end === void 0 ) end = this.length;

        while (this.pos < end) {
            var val = this.readVarint(),
                tag = val >> 3,
                startPos = this.pos;

            this.type = val & 0x7;
            readField(tag, result, this);

            if (this.pos === startPos) { this.skip(val); }
        }
        return result;
    };

    /**
     * @template T
     * @param {(tag: number, result: T, pbf: Pbf) => void} readField
     * @param {T} result
     */
    Pbf.prototype.readMessage = function readMessage (readField, result) {
        return this.readFields(readField, result, this.readVarint() + this.pos);
    };

    Pbf.prototype.readFixed32 = function readFixed32 () {
        var val = this.dataView.getUint32(this.pos, true);
        this.pos += 4;
        return val;
    };

    Pbf.prototype.readSFixed32 = function readSFixed32 () {
        var val = this.dataView.getInt32(this.pos, true);
        this.pos += 4;
        return val;
    };

    // 64-bit int handling is based on github.com/dpw/node-buffer-more-ints (MIT-licensed)

    Pbf.prototype.readFixed64 = function readFixed64 () {
        var val = this.dataView.getUint32(this.pos, true) + this.dataView.getUint32(this.pos + 4, true) * SHIFT_LEFT_32;
        this.pos += 8;
        return val;
    };

    Pbf.prototype.readSFixed64 = function readSFixed64 () {
        var val = this.dataView.getUint32(this.pos, true) + this.dataView.getInt32(this.pos + 4, true) * SHIFT_LEFT_32;
        this.pos += 8;
        return val;
    };

    Pbf.prototype.readFloat = function readFloat () {
        var val = this.dataView.getFloat32(this.pos, true);
        this.pos += 4;
        return val;
    };

    Pbf.prototype.readDouble = function readDouble () {
        var val = this.dataView.getFloat64(this.pos, true);
        this.pos += 8;
        return val;
    };

    /**
     * @param {boolean} [isSigned]
     */
    Pbf.prototype.readVarint = function readVarint (isSigned) {
        var buf = this.buf;
        var val, b;

        b = buf[this.pos++]; val  =  b & 0x7f;    if (b < 0x80) { return val; }
        b = buf[this.pos++]; val |= (b & 0x7f) << 7;  if (b < 0x80) { return val; }
        b = buf[this.pos++]; val |= (b & 0x7f) << 14; if (b < 0x80) { return val; }
        b = buf[this.pos++]; val |= (b & 0x7f) << 21; if (b < 0x80) { return val; }
        b = buf[this.pos];   val |= (b & 0x0f) << 28;

        return readVarintRemainder(val, isSigned, this);
    };

    Pbf.prototype.readVarint64 = function readVarint64 () { // for compatibility with v2.0.1
        return this.readVarint(true);
    };

    Pbf.prototype.readSVarint = function readSVarint () {
        var num = this.readVarint();
        return num % 2 === 1 ? (num + 1) / -2 : num / 2; // zigzag encoding
    };

    Pbf.prototype.readBoolean = function readBoolean () {
        return Boolean(this.readVarint());
    };

    Pbf.prototype.readString = function readString () {
        var end = this.readVarint() + this.pos;
        var pos = this.pos;
        this.pos = end;

        if (end - pos >= TEXT_DECODER_MIN_LENGTH && utf8TextDecoder) {
            // longer strings are fast with the built-in browser TextDecoder API
            return utf8TextDecoder.decode(this.buf.subarray(pos, end));
        }
        // short strings are fast with our custom implementation
        return readUtf8(this.buf, pos, end);
    };

    Pbf.prototype.readBytes = function readBytes () {
        var end = this.readVarint() + this.pos,
            buffer = this.buf.subarray(this.pos, end);
        this.pos = end;
        return buffer;
    };

    // verbose for performance reasons; doesn't affect gzipped size

    /**
     * @param {number[]} [arr]
     * @param {boolean} [isSigned]
     */
    Pbf.prototype.readPackedVarint = function readPackedVarint (arr, isSigned) {
            if ( arr === void 0 ) arr = [];

        var end = this.readPackedEnd();
        while (this.pos < end) { arr.push(this.readVarint(isSigned)); }
        return arr;
    };
    /** @param {number[]} [arr] */
    Pbf.prototype.readPackedSVarint = function readPackedSVarint (arr) {
            if ( arr === void 0 ) arr = [];

        var end = this.readPackedEnd();
        while (this.pos < end) { arr.push(this.readSVarint()); }
        return arr;
    };
    /** @param {boolean[]} [arr] */
    Pbf.prototype.readPackedBoolean = function readPackedBoolean (arr) {
            if ( arr === void 0 ) arr = [];

        var end = this.readPackedEnd();
        while (this.pos < end) { arr.push(this.readBoolean()); }
        return arr;
    };
    /** @param {number[]} [arr] */
    Pbf.prototype.readPackedFloat = function readPackedFloat (arr) {
            if ( arr === void 0 ) arr = [];

        var end = this.readPackedEnd();
        while (this.pos < end) { arr.push(this.readFloat()); }
        return arr;
    };
    /** @param {number[]} [arr] */
    Pbf.prototype.readPackedDouble = function readPackedDouble (arr) {
            if ( arr === void 0 ) arr = [];

        var end = this.readPackedEnd();
        while (this.pos < end) { arr.push(this.readDouble()); }
        return arr;
    };
    /** @param {number[]} [arr] */
    Pbf.prototype.readPackedFixed32 = function readPackedFixed32 (arr) {
            if ( arr === void 0 ) arr = [];

        var end = this.readPackedEnd();
        while (this.pos < end) { arr.push(this.readFixed32()); }
        return arr;
    };
    /** @param {number[]} [arr] */
    Pbf.prototype.readPackedSFixed32 = function readPackedSFixed32 (arr) {
            if ( arr === void 0 ) arr = [];

        var end = this.readPackedEnd();
        while (this.pos < end) { arr.push(this.readSFixed32()); }
        return arr;
    };
    /** @param {number[]} [arr] */
    Pbf.prototype.readPackedFixed64 = function readPackedFixed64 (arr) {
            if ( arr === void 0 ) arr = [];

        var end = this.readPackedEnd();
        while (this.pos < end) { arr.push(this.readFixed64()); }
        return arr;
    };
    /** @param {number[]} [arr] */
    Pbf.prototype.readPackedSFixed64 = function readPackedSFixed64 (arr) {
            if ( arr === void 0 ) arr = [];

        var end = this.readPackedEnd();
        while (this.pos < end) { arr.push(this.readSFixed64()); }
        return arr;
    };
    Pbf.prototype.readPackedEnd = function readPackedEnd () {
        return this.type === PBF_BYTES ? this.readVarint() + this.pos : this.pos + 1;
    };

    /** @param {number} val */
    Pbf.prototype.skip = function skip (val) {
        var type = val & 0x7;
        if (type === PBF_VARINT) { while (this.buf[this.pos++] > 0x7f) {} }
        else if (type === PBF_BYTES) { this.pos = this.readVarint() + this.pos; }
        else if (type === PBF_FIXED32) { this.pos += 4; }
        else if (type === PBF_FIXED64) { this.pos += 8; }
        else { throw new Error(("Unimplemented type: " + type)); }
    };

    // === WRITING =================================================================

    /**
     * @param {number} tag
     * @param {number} type
     */
    Pbf.prototype.writeTag = function writeTag (tag, type) {
        this.writeVarint((tag << 3) | type);
    };

    /** @param {number} min */
    Pbf.prototype.realloc = function realloc (min) {
        var length = this.length || 16;

        while (length < this.pos + min) { length *= 2; }

        if (length !== this.length) {
            var buf = new Uint8Array(length);
            buf.set(this.buf);
            this.buf = buf;
            this.dataView = new DataView(buf.buffer);
            this.length = length;
        }
    };

    Pbf.prototype.finish = function finish () {
        this.length = this.pos;
        this.pos = 0;
        return this.buf.subarray(0, this.length);
    };

    /** @param {number} val */
    Pbf.prototype.writeFixed32 = function writeFixed32 (val) {
        this.realloc(4);
        this.dataView.setInt32(this.pos, val, true);
        this.pos += 4;
    };

    /** @param {number} val */
    Pbf.prototype.writeSFixed32 = function writeSFixed32 (val) {
        this.realloc(4);
        this.dataView.setInt32(this.pos, val, true);
        this.pos += 4;
    };

    /** @param {number} val */
    Pbf.prototype.writeFixed64 = function writeFixed64 (val) {
        this.realloc(8);
        this.dataView.setInt32(this.pos, val & -1, true);
        this.dataView.setInt32(this.pos + 4, Math.floor(val * SHIFT_RIGHT_32), true);
        this.pos += 8;
    };

    /** @param {number} val */
    Pbf.prototype.writeSFixed64 = function writeSFixed64 (val) {
        this.realloc(8);
        this.dataView.setInt32(this.pos, val & -1, true);
        this.dataView.setInt32(this.pos + 4, Math.floor(val * SHIFT_RIGHT_32), true);
        this.pos += 8;
    };

    /** @param {number} val */
    Pbf.prototype.writeVarint = function writeVarint (val) {
        val = +val || 0;

        if (val > 0xfffffff || val < 0) {
            writeBigVarint(val, this);
            return;
        }

        this.realloc(4);

        this.buf[this.pos++] =       val & 0x7f  | (val > 0x7f ? 0x80 : 0); if (val <= 0x7f) { return; }
        this.buf[this.pos++] = ((val >>>= 7) & 0x7f) | (val > 0x7f ? 0x80 : 0); if (val <= 0x7f) { return; }
        this.buf[this.pos++] = ((val >>>= 7) & 0x7f) | (val > 0x7f ? 0x80 : 0); if (val <= 0x7f) { return; }
        this.buf[this.pos++] =   (val >>> 7) & 0x7f;
    };

    /** @param {number} val */
    Pbf.prototype.writeSVarint = function writeSVarint (val) {
        this.writeVarint(val < 0 ? -val * 2 - 1 : val * 2);
    };

    /** @param {boolean} val */
    Pbf.prototype.writeBoolean = function writeBoolean (val) {
        this.writeVarint(+val);
    };

    /** @param {string} str */
    Pbf.prototype.writeString = function writeString (str) {
        str = String(str);
        this.realloc(str.length * 4);

        this.pos++; // reserve 1 byte for short string length

        var startPos = this.pos;
        // write the string directly to the buffer and see how much was written
        this.pos = writeUtf8(this.buf, str, this.pos);
        var len = this.pos - startPos;

        if (len >= 0x80) { makeRoomForExtraLength(startPos, len, this); }

        // finally, write the message length in the reserved place and restore the position
        this.pos = startPos - 1;
        this.writeVarint(len);
        this.pos += len;
    };

    /** @param {number} val */
    Pbf.prototype.writeFloat = function writeFloat (val) {
        this.realloc(4);
        this.dataView.setFloat32(this.pos, val, true);
        this.pos += 4;
    };

    /** @param {number} val */
    Pbf.prototype.writeDouble = function writeDouble (val) {
        this.realloc(8);
        this.dataView.setFloat64(this.pos, val, true);
        this.pos += 8;
    };

    /** @param {Uint8Array} buffer */
    Pbf.prototype.writeBytes = function writeBytes (buffer) {
        var len = buffer.length;
        this.writeVarint(len);
        this.realloc(len);
        for (var i = 0; i < len; i++) { this.buf[this.pos++] = buffer[i]; }
    };

    /**
     * @template T
     * @param {(obj: T, pbf: Pbf) => void} fn
     * @param {T} obj
     */
    Pbf.prototype.writeRawMessage = function writeRawMessage (fn, obj) {
        this.pos++; // reserve 1 byte for short message length

        // write the message directly to the buffer and see how much was written
        var startPos = this.pos;
        fn(obj, this);
        var len = this.pos - startPos;

        if (len >= 0x80) { makeRoomForExtraLength(startPos, len, this); }

        // finally, write the message length in the reserved place and restore the position
        this.pos = startPos - 1;
        this.writeVarint(len);
        this.pos += len;
    };

    /**
     * @template T
     * @param {number} tag
     * @param {(obj: T, pbf: Pbf) => void} fn
     * @param {T} obj
     */
    Pbf.prototype.writeMessage = function writeMessage (tag, fn, obj) {
        this.writeTag(tag, PBF_BYTES);
        this.writeRawMessage(fn, obj);
    };

    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    Pbf.prototype.writePackedVarint = function writePackedVarint$1 (tag, arr) {
        if (arr.length) { this.writeMessage(tag, writePackedVarint, arr); }
    };
    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    Pbf.prototype.writePackedSVarint = function writePackedSVarint$1 (tag, arr) {
        if (arr.length) { this.writeMessage(tag, writePackedSVarint, arr); }
    };
    /**
     * @param {number} tag
     * @param {boolean[]} arr
     */
    Pbf.prototype.writePackedBoolean = function writePackedBoolean$1 (tag, arr) {
        if (arr.length) { this.writeMessage(tag, writePackedBoolean, arr); }
    };
    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    Pbf.prototype.writePackedFloat = function writePackedFloat$1 (tag, arr) {
        if (arr.length) { this.writeMessage(tag, writePackedFloat, arr); }
    };
    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    Pbf.prototype.writePackedDouble = function writePackedDouble$1 (tag, arr) {
        if (arr.length) { this.writeMessage(tag, writePackedDouble, arr); }
    };
    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    Pbf.prototype.writePackedFixed32 = function writePackedFixed32$1 (tag, arr) {
        if (arr.length) { this.writeMessage(tag, writePackedFixed32, arr); }
    };
    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    Pbf.prototype.writePackedSFixed32 = function writePackedSFixed32$1 (tag, arr) {
        if (arr.length) { this.writeMessage(tag, writePackedSFixed32, arr); }
    };
    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    Pbf.prototype.writePackedFixed64 = function writePackedFixed64$1 (tag, arr) {
        if (arr.length) { this.writeMessage(tag, writePackedFixed64, arr); }
    };
    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    Pbf.prototype.writePackedSFixed64 = function writePackedSFixed64$1 (tag, arr) {
        if (arr.length) { this.writeMessage(tag, writePackedSFixed64, arr); }
    };

    /**
     * @param {number} tag
     * @param {Uint8Array} buffer
     */
    Pbf.prototype.writeBytesField = function writeBytesField (tag, buffer) {
        this.writeTag(tag, PBF_BYTES);
        this.writeBytes(buffer);
    };
    /**
     * @param {number} tag
     * @param {number} val
     */
    Pbf.prototype.writeFixed32Field = function writeFixed32Field (tag, val) {
        this.writeTag(tag, PBF_FIXED32);
        this.writeFixed32(val);
    };
    /**
     * @param {number} tag
     * @param {number} val
     */
    Pbf.prototype.writeSFixed32Field = function writeSFixed32Field (tag, val) {
        this.writeTag(tag, PBF_FIXED32);
        this.writeSFixed32(val);
    };
    /**
     * @param {number} tag
     * @param {number} val
     */
    Pbf.prototype.writeFixed64Field = function writeFixed64Field (tag, val) {
        this.writeTag(tag, PBF_FIXED64);
        this.writeFixed64(val);
    };
    /**
     * @param {number} tag
     * @param {number} val
     */
    Pbf.prototype.writeSFixed64Field = function writeSFixed64Field (tag, val) {
        this.writeTag(tag, PBF_FIXED64);
        this.writeSFixed64(val);
    };
    /**
     * @param {number} tag
     * @param {number} val
     */
    Pbf.prototype.writeVarintField = function writeVarintField (tag, val) {
        this.writeTag(tag, PBF_VARINT);
        this.writeVarint(val);
    };
    /**
     * @param {number} tag
     * @param {number} val
     */
    Pbf.prototype.writeSVarintField = function writeSVarintField (tag, val) {
        this.writeTag(tag, PBF_VARINT);
        this.writeSVarint(val);
    };
    /**
     * @param {number} tag
     * @param {string} str
     */
    Pbf.prototype.writeStringField = function writeStringField (tag, str) {
        this.writeTag(tag, PBF_BYTES);
        this.writeString(str);
    };
    /**
     * @param {number} tag
     * @param {number} val
     */
    Pbf.prototype.writeFloatField = function writeFloatField (tag, val) {
        this.writeTag(tag, PBF_FIXED32);
        this.writeFloat(val);
    };
    /**
     * @param {number} tag
     * @param {number} val
     */
    Pbf.prototype.writeDoubleField = function writeDoubleField (tag, val) {
        this.writeTag(tag, PBF_FIXED64);
        this.writeDouble(val);
    };
    /**
     * @param {number} tag
     * @param {boolean} val
     */
    Pbf.prototype.writeBooleanField = function writeBooleanField (tag, val) {
        this.writeVarintField(tag, +val);
    };

    /**
     * @param {number} l
     * @param {boolean | undefined} s
     * @param {Pbf} p
     */
    function readVarintRemainder(l, s, p) {
        var buf = p.buf;
        var h, b;

        b = buf[p.pos++]; h  = (b & 0x70) >> 4;  if (b < 0x80) { return toNum(l, h, s); }
        b = buf[p.pos++]; h |= (b & 0x7f) << 3;  if (b < 0x80) { return toNum(l, h, s); }
        b = buf[p.pos++]; h |= (b & 0x7f) << 10; if (b < 0x80) { return toNum(l, h, s); }
        b = buf[p.pos++]; h |= (b & 0x7f) << 17; if (b < 0x80) { return toNum(l, h, s); }
        b = buf[p.pos++]; h |= (b & 0x7f) << 24; if (b < 0x80) { return toNum(l, h, s); }
        b = buf[p.pos++]; h |= (b & 0x01) << 31; if (b < 0x80) { return toNum(l, h, s); }

        throw new Error('Expected varint not more than 10 bytes');
    }

    /**
     * @param {number} low
     * @param {number} high
     * @param {boolean} [isSigned]
     */
    function toNum(low, high, isSigned) {
        return isSigned ? high * 0x100000000 + (low >>> 0) : ((high >>> 0) * 0x100000000) + (low >>> 0);
    }

    /**
     * @param {number} val
     * @param {Pbf} pbf
     */
    function writeBigVarint(val, pbf) {
        var low, high;

        if (val >= 0) {
            low  = (val % 0x100000000) | 0;
            high = (val / 0x100000000) | 0;
        } else {
            low  = ~(-val % 0x100000000);
            high = ~(-val / 0x100000000);

            if (low ^ 0xffffffff) {
                low = (low + 1) | 0;
            } else {
                low = 0;
                high = (high + 1) | 0;
            }
        }

        if (val >= 0x10000000000000000 || val < -0x10000000000000000) {
            throw new Error('Given varint doesn\'t fit into 10 bytes');
        }

        pbf.realloc(10);

        writeBigVarintLow(low, high, pbf);
        writeBigVarintHigh(high, pbf);
    }

    /**
     * @param {number} high
     * @param {number} low
     * @param {Pbf} pbf
     */
    function writeBigVarintLow(low, high, pbf) {
        pbf.buf[pbf.pos++] = low & 0x7f | 0x80; low >>>= 7;
        pbf.buf[pbf.pos++] = low & 0x7f | 0x80; low >>>= 7;
        pbf.buf[pbf.pos++] = low & 0x7f | 0x80; low >>>= 7;
        pbf.buf[pbf.pos++] = low & 0x7f | 0x80; low >>>= 7;
        pbf.buf[pbf.pos]   = low & 0x7f;
    }

    /**
     * @param {number} high
     * @param {Pbf} pbf
     */
    function writeBigVarintHigh(high, pbf) {
        var lsb = (high & 0x07) << 4;

        pbf.buf[pbf.pos++] |= lsb         | ((high >>>= 3) ? 0x80 : 0); if (!high) { return; }
        pbf.buf[pbf.pos++]  = high & 0x7f | ((high >>>= 7) ? 0x80 : 0); if (!high) { return; }
        pbf.buf[pbf.pos++]  = high & 0x7f | ((high >>>= 7) ? 0x80 : 0); if (!high) { return; }
        pbf.buf[pbf.pos++]  = high & 0x7f | ((high >>>= 7) ? 0x80 : 0); if (!high) { return; }
        pbf.buf[pbf.pos++]  = high & 0x7f | ((high >>>= 7) ? 0x80 : 0); if (!high) { return; }
        pbf.buf[pbf.pos++]  = high & 0x7f;
    }

    /**
     * @param {number} startPos
     * @param {number} len
     * @param {Pbf} pbf
     */
    function makeRoomForExtraLength(startPos, len, pbf) {
        var extraLen =
            len <= 0x3fff ? 1 :
            len <= 0x1fffff ? 2 :
            len <= 0xfffffff ? 3 : Math.floor(Math.log(len) / (Math.LN2 * 7));

        // if 1 byte isn't enough for encoding message length, shift the data to the right
        pbf.realloc(extraLen);
        for (var i = pbf.pos - 1; i >= startPos; i--) { pbf.buf[i + extraLen] = pbf.buf[i]; }
    }

    /**
     * @param {number[]} arr
     * @param {Pbf} pbf
     */
    function writePackedVarint(arr, pbf) {
        for (var i = 0; i < arr.length; i++) { pbf.writeVarint(arr[i]); }
    }
    /**
     * @param {number[]} arr
     * @param {Pbf} pbf
     */
    function writePackedSVarint(arr, pbf) {
        for (var i = 0; i < arr.length; i++) { pbf.writeSVarint(arr[i]); }
    }
    /**
     * @param {number[]} arr
     * @param {Pbf} pbf
     */
    function writePackedFloat(arr, pbf) {
        for (var i = 0; i < arr.length; i++) { pbf.writeFloat(arr[i]); }
    }
    /**
     * @param {number[]} arr
     * @param {Pbf} pbf
     */
    function writePackedDouble(arr, pbf) {
        for (var i = 0; i < arr.length; i++) { pbf.writeDouble(arr[i]); }
    }
    /**
     * @param {boolean[]} arr
     * @param {Pbf} pbf
     */
    function writePackedBoolean(arr, pbf) {
        for (var i = 0; i < arr.length; i++) { pbf.writeBoolean(arr[i]); }
    }
    /**
     * @param {number[]} arr
     * @param {Pbf} pbf
     */
    function writePackedFixed32(arr, pbf) {
        for (var i = 0; i < arr.length; i++) { pbf.writeFixed32(arr[i]); }
    }
    /**
     * @param {number[]} arr
     * @param {Pbf} pbf
     */
    function writePackedSFixed32(arr, pbf) {
        for (var i = 0; i < arr.length; i++) { pbf.writeSFixed32(arr[i]); }
    }
    /**
     * @param {number[]} arr
     * @param {Pbf} pbf
     */
    function writePackedFixed64(arr, pbf) {
        for (var i = 0; i < arr.length; i++) { pbf.writeFixed64(arr[i]); }
    }
    /**
     * @param {number[]} arr
     * @param {Pbf} pbf
     */
    function writePackedSFixed64(arr, pbf) {
        for (var i = 0; i < arr.length; i++) { pbf.writeSFixed64(arr[i]); }
    }

    // Buffer code below from https://github.com/feross/buffer, MIT-licensed

    /**
     * @param {Uint8Array} buf
     * @param {number} pos
     * @param {number} end
     */
    function readUtf8(buf, pos, end) {
        var str = '';
        var i = pos;

        while (i < end) {
            var b0 = buf[i];
            var c = null; // codepoint
            var bytesPerSequence =
                b0 > 0xEF ? 4 :
                b0 > 0xDF ? 3 :
                b0 > 0xBF ? 2 : 1;

            if (i + bytesPerSequence > end) { break; }

            var b1 = (void 0), b2 = (void 0), b3 = (void 0);

            if (bytesPerSequence === 1) {
                if (b0 < 0x80) {
                    c = b0;
                }
            } else if (bytesPerSequence === 2) {
                b1 = buf[i + 1];
                if ((b1 & 0xC0) === 0x80) {
                    c = (b0 & 0x1F) << 0x6 | (b1 & 0x3F);
                    if (c <= 0x7F) {
                        c = null;
                    }
                }
            } else if (bytesPerSequence === 3) {
                b1 = buf[i + 1];
                b2 = buf[i + 2];
                if ((b1 & 0xC0) === 0x80 && (b2 & 0xC0) === 0x80) {
                    c = (b0 & 0xF) << 0xC | (b1 & 0x3F) << 0x6 | (b2 & 0x3F);
                    if (c <= 0x7FF || (c >= 0xD800 && c <= 0xDFFF)) {
                        c = null;
                    }
                }
            } else if (bytesPerSequence === 4) {
                b1 = buf[i + 1];
                b2 = buf[i + 2];
                b3 = buf[i + 3];
                if ((b1 & 0xC0) === 0x80 && (b2 & 0xC0) === 0x80 && (b3 & 0xC0) === 0x80) {
                    c = (b0 & 0xF) << 0x12 | (b1 & 0x3F) << 0xC | (b2 & 0x3F) << 0x6 | (b3 & 0x3F);
                    if (c <= 0xFFFF || c >= 0x110000) {
                        c = null;
                    }
                }
            }

            if (c === null) {
                c = 0xFFFD;
                bytesPerSequence = 1;

            } else if (c > 0xFFFF) {
                c -= 0x10000;
                str += String.fromCharCode(c >>> 10 & 0x3FF | 0xD800);
                c = 0xDC00 | c & 0x3FF;
            }

            str += String.fromCharCode(c);
            i += bytesPerSequence;
        }

        return str;
    }

    /**
     * @param {Uint8Array} buf
     * @param {string} str
     * @param {number} pos
     */
    function writeUtf8(buf, str, pos) {
        for (var i = 0, c = (void 0), lead = (void 0); i < str.length; i++) {
            c = str.charCodeAt(i); // code point

            if (c > 0xD7FF && c < 0xE000) {
                if (lead) {
                    if (c < 0xDC00) {
                        buf[pos++] = 0xEF;
                        buf[pos++] = 0xBF;
                        buf[pos++] = 0xBD;
                        lead = c;
                        continue;
                    } else {
                        c = lead - 0xD800 << 10 | c - 0xDC00 | 0x10000;
                        lead = null;
                    }
                } else {
                    if (c > 0xDBFF || (i + 1 === str.length)) {
                        buf[pos++] = 0xEF;
                        buf[pos++] = 0xBF;
                        buf[pos++] = 0xBD;
                    } else {
                        lead = c;
                    }
                    continue;
                }
            } else if (lead) {
                buf[pos++] = 0xEF;
                buf[pos++] = 0xBF;
                buf[pos++] = 0xBD;
                lead = null;
            }

            if (c < 0x80) {
                buf[pos++] = c;
            } else {
                if (c < 0x800) {
                    buf[pos++] = c >> 0x6 | 0xC0;
                } else {
                    if (c < 0x10000) {
                        buf[pos++] = c >> 0xC | 0xE0;
                    } else {
                        buf[pos++] = c >> 0x12 | 0xF0;
                        buf[pos++] = c >> 0xC & 0x3F | 0x80;
                    }
                    buf[pos++] = c >> 0x6 & 0x3F | 0x80;
                }
                buf[pos++] = c & 0x3F | 0x80;
            }
        }
        return pos;
    }

    // code generated by pbf v4.0.1

    function writeTile(obj, pbf) {
        if (obj.layers) { for (var item of obj.layers) pbf.writeMessage(3, writeTileLayer, item); }
    }

    function writeTileValue(obj, pbf) {
        if (obj.string_value) { pbf.writeStringField(1, obj.string_value); }
        if (obj.float_value) { pbf.writeFloatField(2, obj.float_value); }
        if (obj.double_value) { pbf.writeDoubleField(3, obj.double_value); }
        if (obj.int_value) { pbf.writeVarintField(4, obj.int_value); }
        if (obj.uint_value) { pbf.writeVarintField(5, obj.uint_value); }
        if (obj.sint_value) { pbf.writeSVarintField(6, obj.sint_value); }
        if (obj.bool_value) { pbf.writeBooleanField(7, obj.bool_value); }
    }

    function writeTileFeature(obj, pbf) {
        if (obj.id) { pbf.writeVarintField(1, obj.id); }
        if (obj.tags) { pbf.writePackedVarint(2, obj.tags); }
        if (obj.type) { pbf.writeVarintField(3, obj.type); }
        if (obj.geometry) { pbf.writePackedVarint(4, obj.geometry); }
    }

    function writeTileLayer(obj, pbf) {
        if (obj.version) { pbf.writeVarintField(15, obj.version); }
        if (obj.name) { pbf.writeStringField(1, obj.name); }
        if (obj.features) { for (var item of obj.features) pbf.writeMessage(2, writeTileFeature, item); }
        if (obj.keys) { for (var item$1 of obj.keys) pbf.writeStringField(3, item$1); }
        if (obj.values) { for (var item$2 of obj.values) pbf.writeMessage(4, writeTileValue, item$2); }
        if (obj.extent) { pbf.writeVarintField(5, obj.extent); }
    }

    var MercatorCoordinate = maplibregl.MercatorCoordinate;
    var LngLatBounds = maplibregl.LngLatBounds;

    function parse(url) {
      var tokens = url.replace(/\.pbf$/, "").split("/");
      var y = parseInt(tokens.pop());
      var x = parseInt(tokens.pop());
      var z = parseInt(tokens.pop());

      var n = Math.pow(2, z);
      var tl = new MercatorCoordinate(x / n, y / n);
      var br = new MercatorCoordinate((x + 1) / n, (y + 1) / n);
      var sw = new MercatorCoordinate(x / n, (y + 1) / n).toLngLat();
      var ne = new MercatorCoordinate((x + 1) / n, y / n).toLngLat();

      return {
        tile: { z: z, x: x, y: y },
        bounds: new LngLatBounds(sw, ne),
        mercator: { ox: tl.x, oy: tl.y, w: br.x - tl.x, h: br.y - tl.y },
      };
    }

    function sec2dms(sec) {
      var a = Math.abs(sec);
      return { d: Math.floor(a / 3600), m: Math.floor(a / 60) % 60, s: sec % 60 };
    }
    function lon2id(sec) {
      var ref = sec2dms(sec);
      var d = ref.d;
      var m = ref.m;
      var s = ref.s;
      return (sec < 0 ? 10000000 : 20000000) + d * 10000 + m * 100 + s;
    }
    function lat2id(sec) {
      var ref = sec2dms(sec);
      var d = ref.d;
      var m = ref.m;
      var s = ref.s;
      return (sec < 0 ? 30000000 : 40000000) + d * 10000 + m * 100 + s;
    }

    function encode(lines, extent) {
      var zigzag = function (v) { return (v << 1) ^ (v >> 31); };

      var labels = Array.from(new Set(lines.map(function (a) { return a.label; })));

      var obj = {
        layers: [
          {
            version: 2,
            name: "line",
            features: lines.map(function (ref) {
              var coords = ref.coords;
              var id = ref.id;
              var label = ref.label;

              return ({
              id: id,
              tags: [0, labels.indexOf(label)],
              type: 2,
              geometry: [
                9, // [00001-001] command id 1 : moveTo,  command count 1
                zigzag(coords[0]),
                zigzag(coords[1]),
                10, // [00001-010] command id 2 : lineTo, command count 3
                zigzag(coords[2] - coords[0]),
                zigzag(coords[3] - coords[1]),
                15 ],
            });
      }),
            keys: ["label"],
            values: labels.map(function (label) { return ({ string_value: label }); }),
            extent: extent,
          } ],
      };

      var pbf = new Pbf();
      writeTile(obj, pbf);
      return pbf.finish();
    }

    function createLoadFn(options) {
      var defaultOptions = {
        extent: 4096,
        lon2label: function (sec) {
          var ref = sec2dms(sec);
          var d = ref.d;
          var m = ref.m;
          var s = ref.s;
          var ddd = d.toString().padStart(3, 0);
          var mm = m.toString().padStart(2, 0);
          var ss = s.toString().padStart(2, 0);
          return ((sec < 0 ? "w" : "E") + " " + ddd + " " + mm + " " + ss);
        },
        lat2label: function (sec) {
          var ref = sec2dms(sec);
          var d = ref.d;
          var m = ref.m;
          var s = ref.s;
          var dd = d.toString().padStart(2, 0);
          var mm = m.toString().padStart(2, 0);
          var ss = s.toString().padStart(2, 0);
          return ((sec < 0 ? "S" : "N") + " " + dd + " " + mm + " " + ss);
        },
        interval: function (tile) {
          if (tile.z < 5) { return 3600; }
          if (tile.z < 8) { return 60; }
          return 1;
        },
      };
      if (options) { Object.assign(defaultOptions, options); }
      var extent = defaultOptions.extent;
      var lat2label = defaultOptions.lat2label;
      var lon2label = defaultOptions.lon2label;
      var interval = defaultOptions.interval;

      return function (params, callback) {
        var ref = parse(params.url);
        var tile = ref.tile;
        var bounds = ref.bounds;
        var mercator = ref.mercator;

        var ref$1 = (function () {
          var s = interval(tile);
          return Array.isArray(s) ? s : [s, s];
        })();
        var dx = ref$1[0];
        var dy = ref$1[1];

        var lines = [];

        var x1 = Math.floor((bounds.getWest() * 3600) / dx) * dx;
        var x2 = Math.floor((bounds.getEast() * 3600) / dx) * dx;

        for (var x = x1; x <= x2; x += dx) {
          var mx = MercatorCoordinate.fromLngLat([x / 3600, 0]).x;
          var tx = Math.floor((extent * (mx - mercator.ox)) / mercator.w);
          if (0 <= tx && tx <= extent)
            { lines.push({ coords: [tx, 0, tx, extent], id: lon2id(x), label: lon2label(x) }); }
        }

        var y1 = Math.floor((bounds.getSouth() * 3600) / dy) * dy;
        var y2 = Math.floor((bounds.getNorth() * 3600) / dy) * dy;

        for (var y = y1; y <= y2; y += dy) {
          var my = MercatorCoordinate.fromLngLat([0, y / 3600, 0]).y;
          var ty = Math.floor((extent * (my - mercator.oy)) / mercator.h);
          if (0 <= ty && ty <= extent)
            { lines.push({ coords: [0, ty, extent, ty], id: lat2id(y), label: lat2label(y) }); }
        }

        var bin = encode(lines, extent);
        var version = maplibregl.version || maplibregl.getVersion();
        if (parseInt(version.split(".")[0]) <= 3) { callback(null, bin, null, null); }
        else { return Promise.resolve({ data: bin }); }
      };
    }

    exports.createLoadFn = createLoadFn;

    return exports;

})({});
