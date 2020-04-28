import * as lua from "LuaAST";
import { TransformState } from "TSTransformer";
import { diagnostics } from "TSTransformer/diagnostics";
import {
	createAssignmentExpression,
	createCompoundAssignmentExpression,
	isAssignmentOperator,
	isCompoundAssignmentOperator,
} from "TSTransformer/util/assignment";
import { createBinaryFromOperator } from "TSTransformer/util/createBinaryFromOperator";
import { ensureTransformOrder } from "TSTransformer/util/ensureTransformOrder";
import { transformLogical } from "TSTransformer/util/transformLogical";
import { transformWritableAssignmentWithType } from "TSTransformer/util/transformWritable";
import ts from "typescript";

export function transformBinaryExpression(state: TransformState, node: ts.BinaryExpression) {
	const operatorKind = node.operatorToken.kind;

	// banned
	if (operatorKind === ts.SyntaxKind.EqualsEqualsToken) {
		state.addDiagnostic(diagnostics.noEqualsEquals(node));
		return lua.emptyId();
	} else if (operatorKind === ts.SyntaxKind.ExclamationEqualsToken) {
		state.addDiagnostic(diagnostics.noExclamationEquals(node));
		return lua.emptyId();
	}

	// logical
	if (
		operatorKind === ts.SyntaxKind.AmpersandAmpersandToken ||
		operatorKind === ts.SyntaxKind.BarBarToken ||
		operatorKind === ts.SyntaxKind.QuestionQuestionToken
	) {
		return transformLogical(state, node);
	}

	if (isAssignmentOperator(operatorKind)) {
		const { writable, value } = transformWritableAssignmentWithType(state, node.left, node.right);
		if (isCompoundAssignmentOperator(operatorKind)) {
			return createCompoundAssignmentExpression(state, writable, operatorKind, value);
		} else {
			return createAssignmentExpression(state, writable.node, value.node);
		}
	}

	const [left, right] = ensureTransformOrder(state, [node.left, node.right]);

	return createBinaryFromOperator(
		{
			node: left,
			type: state.getSimpleType(node.left),
		},
		operatorKind,
		{
			node: right,
			type: state.getSimpleType(node.right),
		},
	);
}