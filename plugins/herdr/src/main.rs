mod cli;
mod locate;
mod server;
mod tools;
#[cfg(unix)]
mod watch;

use rmcp::ServiceExt;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let service = server::HerdrServer::new(locate::find_herdr)
        .serve(rmcp::transport::stdio())
        .await?;
    service.waiting().await?;
    #[cfg(unix)]
    watch::cleanup();
    Ok(())
}