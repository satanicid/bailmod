"use strict"

Object.defineProperty(exports, "__esModule", { value: true })

const WAProto_1 = require("../../WAProto")

Object.defineProperty(exports, "__esModule", { value: true })

const WAMessageAddressingMode = {
	PN: 'pn', 
	LID: 'lid'
}

module.exports = {
  WAMessageAddressingMode, 
  WAMessageStubType: WAProto_1.proto.WebMessageInfo.StubType, 
  WAMessageStatus: WAProto_1.proto.WebMessageInfo.Status, 
  WAProto: WAProto_1.proto,
  AssociationType: WAProto_1.proto.MessageAssociation.AssociationType,
  ButtonHeaderType: WAProto_1.proto.Message.ButtonsMessage.HeaderType,
  ButtonType: WAProto_1.proto.Message.ButtonsMessage.Button.Type,
  CarouselCardType: WAProto_1.proto.Message.InteractiveMessage.CarouselMessage.CarouselCardType,
  ListType: WAProto_1.proto.Message.ListMessage.ListType,
  ProtocolType: WAProto_1.proto.Message.ProtocolMessage.Type
}