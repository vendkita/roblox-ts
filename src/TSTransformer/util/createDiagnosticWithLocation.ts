import ts from "byots";

export function createDiagnosticWithLocation(message: string, node: ts.Node): ts.DiagnosticWithLocation {
	return {
		category: ts.DiagnosticCategory.Error,
		code: (" roblox-ts" as unknown) as number,
		file: node.getSourceFile(),
		messageText: message,
		start: node.getStart(),
		length: node.getWidth(),
	};
}
