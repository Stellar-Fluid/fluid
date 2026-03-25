fn main() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("wasm32") {
        return Ok(());
    }

    println!("cargo:rerun-if-changed=../proto/signer.proto");

    let protoc_path = protoc_bin_vendored::protoc_bin_path()?;
    std::env::set_var("PROTOC", protoc_path);

    tonic_build::configure()
        .build_server(true)
        .build_client(false)
        .compile_protos(&["../proto/signer.proto"], &["../proto"])?;

    Ok(())
}
