mod image_encode;
mod locate;
mod relay;
mod result;
mod script;
mod server;
mod shots;
mod tool;

use rmcp::ServiceExt;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    shots::sweep_stale();
    let service = server::BrowserServer::new(locate::find_ego_browser)
        .serve(rmcp::transport::stdio())
        .await?;
    service.waiting().await?;
    Ok(())
}
