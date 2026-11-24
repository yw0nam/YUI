mod cli;
mod locate;
mod parse;
mod server;
mod tools;
#[cfg(unix)]
mod watch;

use rmcp::ServiceExt;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(unix)]
    let server = server::HerdrServer::new(locate::find_herdr, watch::spawn);
    #[cfg(not(unix))]
    let server = server::HerdrServer::new(locate::find_herdr);
    let service = server.serve(rmcp::transport::stdio()).await?;
    service.waiting().await?;
    #[cfg(unix)]
    watch::cleanup();
    Ok(())
}
