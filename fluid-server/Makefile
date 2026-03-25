WASM_PACK ?= wasm-pack

.PHONY: wasm-build wasm-build-web wasm-build-node wasm-test-node wasm-test-browser wasm-demo-serve

wasm-build: wasm-build-web wasm-build-node

wasm-build-web:
	$(WASM_PACK) build --release --target web --out-dir pkg/web

wasm-build-node:
	$(WASM_PACK) build --release --target nodejs --out-dir pkg/node

wasm-test-node: wasm-build
	npm --prefix wasm-demo ci
	npm --prefix wasm-demo run test:node

wasm-test-browser: wasm-build
	npm --prefix wasm-demo ci
	npm --prefix wasm-demo run test:browser

wasm-demo-serve: wasm-build
	node wasm-demo/server.mjs
