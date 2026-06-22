"use strict"

Object.defineProperty(exports, "__esModule", { value: true })

const boom_1 = require("@hapi/boom")
const WAProto_1 = require("../../WAProto")
const crypto = require("crypto")

// some extra useful utilities
const getBinaryNodeChildren = (node, childTag) => {
    if (Array.isArray(node?.content)) {
        return node.content.filter(item => item.tag === childTag)
    }
    return []
}

const getAllBinaryNodeChildren = ({ content }) => {
    if (Array.isArray(content)) {
        return content
    }
    return []
}

const getBinaryNodeChild = (node, childTag) => {
    if (Array.isArray(node?.content)) {
        return node?.content.find(item => item.tag === childTag)
    }
}

const getBinaryNodeChildBuffer = (node, childTag) => {
    const child = getBinaryNodeChild(node, childTag)?.content
    if (Buffer.isBuffer(child) || child instanceof Uint8Array) {
        return child
    }
}

const getBinaryNodeChildString = (node, childTag) => {
    const child = getBinaryNodeChild(node, childTag)?.content
    if (Buffer.isBuffer(child) || child instanceof Uint8Array) {
        return Buffer.from(child).toString('utf-8')
    }
    else if (typeof child === 'string') {
        return child
    }
}

const getBinaryNodeChildUInt = (node, childTag, length) => {
    const buff = getBinaryNodeChildBuffer(node, childTag)
    if (buff) {
        return bufferToUInt(buff, length)
    }
}

const assertNodeErrorFree = (node) => {
    const errNode = getBinaryNodeChild(node, 'error')
    if (errNode) {
        throw new boom_1.Boom(errNode.attrs.text || 'Unknown error', { data: +errNode.attrs.code })
    }
}

const reduceBinaryNodeToDictionary = (node, tag) => {
    const nodes = getBinaryNodeChildren(node, tag)
    const dict = nodes.reduce((dict, { attrs }) => {
        dict[attrs.name || attrs.config_code] = attrs.value || attrs.config_value
        return dict
    }, {})
    return dict
}

const getBinaryNodeMessages = ({ content }) => {
    const msgs = []
    if (Array.isArray(content)) {
        for (const item of content) {
            if (item.tag === 'message') {
                msgs.push(WAProto_1.proto.WebMessageInfo.decode(item.content))
            }
        }
    }
    return msgs
}

const getBinaryFilteredButtons = (nodeContent) => {
	if (!Array.isArray(nodeContent)) return false

    return nodeContent.some(a =>
        ['native_flow'].includes(a?.content?.[0]?.content?.[0]?.tag) ||
        ['interactive', 'buttons', 'list'].includes(a?.content?.[0]?.tag) ||
        ['hsm', 'biz'].includes(a?.tag)
    )
}

const getBinaryFilteredBizBot = (nodeContent) => {
    if (!Array.isArray(nodeContent)) return false 

    return nodeContent.some(b => 
        ['bot'].includes(b?.tag) && b?.attrs?.biz_bot === '1'
    ) 
}

function bufferToUInt(e, t) {
    let a = 0
    for (let i = 0; i < t; i++) {
        a = 256 * a + e[i]
    }
    return a
}
const tabs = (n) => '\t'.repeat(n)
function binaryNodeToString(node, i = 0) {
    if (!node) {
        return node
    }
    if (typeof node === 'string') {
        return tabs(i) + node
    }
    if (node instanceof Uint8Array) {
        return tabs(i) + Buffer.from(node).toString('hex')
    }
    if (Array.isArray(node)) {
        return node.map((x) => tabs(i + 1) + binaryNodeToString(x, i + 1)).join('\n')
    }
    const children = binaryNodeToString(node.content, i + 1)
    const tag = `<${node.tag} ${Object.entries(node.attrs || {})
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}='${v}'`)
        .join(' ')}`
    const content = children ? `>\n${children}\n${tabs(i)}</${node.tag}>` : '/>'
    return tag + content
}

const FLOWS_MAP = {
    mpm: true,
    cta_catalog: true,
    send_location: true,
    call_permission_request: true,
    wa_payment_transaction_details: true,
    automated_greeting_message_view_catalog: true
};
const DECISION_SOURCE_CONTENT = [
    {
        tag: 'decision_source',
        attrs: { value: 'df' }
    }
];
const LIST_TYPE_CONTENT = {
    tag: 'list',
    attrs: { v: '2', type: 'product_list' }
};
const NATIVE_FLOW_ATTRIBUTE = { type: 'native_flow', v: '1' };
const MIXED_NATIVE_FLOW = {
    tag: 'interactive',
    attrs: NATIVE_FLOW_ATTRIBUTE,
    content: [
        {
            tag: 'native_flow',
            attrs: { v: '9', name: 'mixed' }
        }
    ]
};
const getBizBinaryNode = (message) => {
    const flowMsg = message.interactiveMessage?.nativeFlowMessage;
    const firstButtonName = flowMsg?.buttons?.[0]?.name;
    const qualityContent = {
        tag: 'quality_control',
        attrs: {
            decision_id: crypto.randomBytes(20).toString('hex'),
            source_type: 'third_party'
        },
        content: DECISION_SOURCE_CONTENT
    };
    const bizAttributes = {
        actual_actors: '2',
        host_storage: '2',
        privacy_mode_ts: `${Date.now() / 1_000 | 0}`
    };
    if (firstButtonName === 'review_and_pay' || firstButtonName === 'payment_info') {
        bizAttributes.native_flow_name = firstButtonName === 'review_and_pay' ?
            'order_details' :
            firstButtonName;
        return {
            tag: 'biz',
            attrs: bizAttributes,
            content: [qualityContent]
        };
    }
    if (firstButtonName && FLOWS_MAP[firstButtonName]) {
        return {
            tag: 'biz',
            attrs: bizAttributes,
            content: [
                {
                    tag: 'interactive',
                    attrs: NATIVE_FLOW_ATTRIBUTE,
                    content: [
                        {
                            tag: 'native_flow',
                            attrs: { v: '2', name: firstButtonName }
                        }
                    ]
                },
                qualityContent
            ]
        };
    }
    if (flowMsg || message.buttonsMessage || message.templateMessage) {
        return {
            tag: 'biz',
            attrs: bizAttributes,
            content: [
                MIXED_NATIVE_FLOW,
                qualityContent
            ]
        };
    }
    if (message.listMessage) {
        return {
            tag: 'biz',
            attrs: bizAttributes,
            content: [
                LIST_TYPE_CONTENT,
                qualityContent
            ]
        };
    }
    return {
        tag: 'biz',
        attrs: bizAttributes,
        content: [qualityContent]
    };
};

module.exports = {
  getBinaryNodeChildren, 
  getAllBinaryNodeChildren, 
  getBinaryNodeChild, 
  getBinaryNodeChildBuffer, 
  getBinaryNodeChildString, 
  getBinaryNodeChildUInt, 
  assertNodeErrorFree, 
  reduceBinaryNodeToDictionary, 
  getBinaryNodeMessages, 
  getBinaryFilteredButtons, 
  getBinaryFilteredBizBot, 
  binaryNodeToString,
  getBizBinaryNode
}