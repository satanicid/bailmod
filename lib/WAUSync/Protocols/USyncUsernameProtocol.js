"use strict"

Object.defineProperty(exports, "__esModule", { value: true })
exports.USyncUsernameProtocol = void 0

const WABinary_1 = require("../../WABinary")

class USyncUsernameProtocol {
    constructor() {
        this.name = 'username'
    }
    getQueryElement() {
        return {
            tag: 'username',
            attrs: {}
        }
    }
    getUserElement(user) {
        void user
        return null
    }
    parser(node) {
        if (node.tag === 'username') {
            WABinary_1.assertNodeErrorFree(node)
            const content = node.content
            if (Buffer.isBuffer(content) || content instanceof Uint8Array) return Buffer.from(content).toString('utf-8')
            if (typeof content === 'string') return content
        }
        return null
    }
}

exports.USyncUsernameProtocol = USyncUsernameProtocol
module.exports = {
    USyncUsernameProtocol
}
