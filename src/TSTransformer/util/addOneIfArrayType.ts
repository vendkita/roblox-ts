import luau from "@roblox-ts/luau-ast";
import { TransformState } from "TSTransformer";
import { offset } from "TSTransformer/util/offset";
import { isArrayType, isDefinitelyType, isUndefinedType } from "TSTransformer/util/types";
import ts from "typescript";

export function addOneIfArrayType(
	state: TransformState,
	type: ts.Type | ReadonlyArray<ts.Type>,
	expression: luau.Expression,
	originNode: ts.Node,
) {
	if (ts.isArray(type) || isDefinitelyType(state, type, originNode, isArrayType(state), isUndefinedType)) {
		return offset(expression, 1);
	} else {
		return expression;
	}
}
