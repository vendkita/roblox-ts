import * as ts from "ts-morph";
import { checkApiAccess, transpileExpression } from ".";
import { TranspilerError, TranspilerErrorType } from "../errors/TranspilerError";
import { TranspilerState } from "../TranspilerState";
import { isArrayType, isTupleReturnType, typeConstraint } from "../typeUtilities";
import { checkNonAny } from "./security";

const STRING_MACRO_METHODS = [
	"byte",
	"find",
	"format",
	"gmatch",
	"gsub",
	"len",
	"lower",
	"match",
	"rep",
	"reverse",
	"sub",
	"upper",
];

const RBX_MATH_CLASSES = ["CFrame", "UDim", "UDim2", "Vector2", "Vector2int16", "Vector3", "Vector3int16"];

export function transpileCallArguments(state: TranspilerState, args: Array<ts.Node>) {
	const argStrs = new Array<string>();
	for (const arg of args) {
		if (!ts.TypeGuards.isSpreadElement(arg)) {
			checkNonAny(arg);
		}
		argStrs.push(transpileExpression(state, arg as ts.Expression));
	}
	return argStrs.join(", ");
}

export function transpileCallExpression(state: TranspilerState, node: ts.CallExpression, doNotWrapTupleReturn = false) {
	const exp = node.getExpression();
	checkNonAny(exp);
	if (ts.TypeGuards.isPropertyAccessExpression(exp)) {
		return transpilePropertyCallExpression(state, node, doNotWrapTupleReturn);
	} else if (ts.TypeGuards.isSuperExpression(exp)) {
		let params = transpileCallArguments(state, node.getArguments());
		if (params.length > 0) {
			params = ", " + params;
		}
		params = "self" + params;
		const className = exp
			.getType()
			.getSymbolOrThrow()
			.getName();
		return `${className}.constructor(${params})`;
	} else {
		const callPath = transpileExpression(state, exp);
		const params = transpileCallArguments(state, node.getArguments());
		let result = `${callPath}(${params})`;
		if (!doNotWrapTupleReturn && isTupleReturnType(node)) {
			result = `{ ${result} }`;
		}
		return result;
	}
}

export function transpilePropertyCallExpression(
	state: TranspilerState,
	node: ts.CallExpression,
	doNotWrapTupleReturn = false,
) {
	const expression = node.getExpression();
	if (!ts.TypeGuards.isPropertyAccessExpression(expression)) {
		throw new TranspilerError(
			"Expected PropertyAccessExpression",
			node,
			TranspilerErrorType.ExpectedPropertyAccessExpression,
		);
	}

	checkApiAccess(state, expression.getNameNode());

	const subExp = expression.getExpression();
	const subExpType = subExp.getType();
	let accessPath = transpileExpression(state, subExp);
	const property = expression.getName();
	let params = transpileCallArguments(state, node.getArguments());

	if (isArrayType(subExpType)) {
		let paramStr = accessPath;
		if (params.length > 0) {
			paramStr += ", " + params;
		}
		state.usesTSLibrary = true;
		return `TS.array_${property}(${paramStr})`;
	}

	if (subExpType.isString() || subExpType.isStringLiteral()) {
		let paramStr = accessPath;
		if (params.length > 0) {
			paramStr += ", " + params;
		}
		if (STRING_MACRO_METHODS.indexOf(property) !== -1) {
			return `string.${property}(${paramStr})`;
		}
		state.usesTSLibrary = true;
		return `TS.string_${property}(${paramStr})`;
	}

	const subExpTypeSym = subExpType.getSymbol();
	if (subExpTypeSym && ts.TypeGuards.isPropertyAccessExpression(expression)) {
		const subExpTypeName = subExpTypeSym.getEscapedName();

		// custom promises
		if (subExpTypeName === "Promise") {
			if (property === "then") {
				return `${accessPath}:andThen(${params})`;
			}
		}

		// for is a reserved word in Lua
		if (subExpTypeName === "SymbolConstructor") {
			if (property === "for") {
				return `${accessPath}.getFor(${params})`;
			}
		}

		if (subExpTypeName === "Map" || subExpTypeName === "ReadonlyMap" || subExpTypeName === "WeakMap") {
			let paramStr = accessPath;
			if (params.length > 0) {
				paramStr += ", " + params;
			}
			state.usesTSLibrary = true;
			return `TS.map_${property}(${paramStr})`;
		}

		if (subExpTypeName === "Set" || subExpTypeName === "ReadonlySet" || subExpTypeName === "WeakSet") {
			let paramStr = accessPath;
			if (params.length > 0) {
				paramStr += ", " + params;
			}
			state.usesTSLibrary = true;
			return `TS.set_${property}(${paramStr})`;
		}

		if (subExpTypeName === "ObjectConstructor") {
			state.usesTSLibrary = true;
			return `TS.Object_${property}(${params})`;
		}

		const validateMathCall = () => {
			if (ts.TypeGuards.isExpressionStatement(node.getParent())) {
				throw new TranspilerError(
					`${subExpTypeName}.${property}() cannot be an expression statement!`,
					node,
					TranspilerErrorType.NoMacroMathExpressionStatement,
				);
			}
		};

		// custom math
		if (RBX_MATH_CLASSES.indexOf(subExpTypeName) !== -1) {
			switch (property) {
				case "add":
					validateMathCall();
					return `(${accessPath} + (${params}))`;
				case "sub":
					validateMathCall();
					return `(${accessPath} - (${params}))`;
				case "mul":
					validateMathCall();
					return `(${accessPath} * (${params}))`;
				case "div":
					validateMathCall();
					return `(${accessPath} / (${params}))`;
			}
		}
	}

	const expType = expression.getType();

	const allMethods = typeConstraint(expType, t =>
		t
			.getSymbolOrThrow()
			.getDeclarations()
			.every(dec => {
				if (ts.TypeGuards.isParameteredNode(dec)) {
					const thisParam = dec.getParameter("this");
					if (thisParam) {
						const structure = thisParam.getStructure();
						if (structure.type === "void") {
							return false;
						} else if (structure.type === "this") {
							return true;
						}
					}
				}
				if (ts.TypeGuards.isMethodDeclaration(dec) || ts.TypeGuards.isMethodSignature(dec)) {
					return true;
				}
				return false;
			}),
	);

	const allCallbacks = typeConstraint(expType, t =>
		t
			.getSymbolOrThrow()
			.getDeclarations()
			.every(dec => {
				if (ts.TypeGuards.isParameteredNode(dec)) {
					const thisParam = dec.getParameter("this");
					if (thisParam) {
						const structure = thisParam.getStructure();
						if (structure.type === "void") {
							return true;
						} else if (structure.type === "this") {
							return false;
						}
					}
				}
				if (
					ts.TypeGuards.isFunctionTypeNode(dec) ||
					ts.TypeGuards.isPropertySignature(dec) ||
					ts.TypeGuards.isFunctionExpression(dec) ||
					ts.TypeGuards.isArrowFunction(dec) ||
					ts.TypeGuards.isFunctionDeclaration(dec)
				) {
					return true;
				}
				return false;
			}),
	);

	let sep: string;
	if (allMethods && !allCallbacks) {
		if (ts.TypeGuards.isSuperExpression(subExp)) {
			const className = subExp
				.getType()
				.getSymbolOrThrow()
				.getName();
			accessPath = className + ".__index";
			params = "self" + (params.length > 0 ? ", " : "") + params;
			sep = ".";
		} else {
			sep = ":";
		}
	} else if (!allMethods && allCallbacks) {
		sep = ".";
	} else {
		// mixed methods and callbacks
		throw new TranspilerError(
			"Attempted to call a function with mixed types! All definitions must either be a method or a callback.",
			node,
			TranspilerErrorType.MixedMethodCall,
		);
	}

	let result = `${accessPath}${sep}${property}(${params})`;
	if (!doNotWrapTupleReturn && isTupleReturnType(node)) {
		result = `{ ${result} }`;
	}
	return result;
}
