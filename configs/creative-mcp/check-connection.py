#!/usr/bin/env python3
"""Read-only operator check: initialize and list tools through the real launcher."""
import argparse
import asyncio
import json


async def check(command):
    process = await asyncio.create_subprocess_exec(
        *command, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        # Keep server diagnostics visible without risking a full unread pipe.
    )

    async def request(identifier, method, params):
        message = {"jsonrpc": "2.0", "id": identifier, "method": method, "params": params}
        process.stdin.write((json.dumps(message) + "\n").encode())
        await process.stdin.drain()
        while True:
            line = await asyncio.wait_for(process.stdout.readline(), timeout=40)
            if not line:
                raise RuntimeError("MCP server closed stdout before responding")
            response = json.loads(line)
            if response.get("id") == identifier:
                if "error" in response:
                    raise RuntimeError(str(response["error"]))
                return response["result"]

    try:
        result = await request(1, "initialize", {
            "protocolVersion": "2024-11-05", "capabilities": {},
            "clientInfo": {"name": "setup-read-only-check", "version": "1"},
        })
        print("Server:", json.dumps(result.get("serverInfo")))
        process.stdin.write(b'{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
        await process.stdin.drain()
        result = await request(2, "tools/list", {})
        tools = [tool["name"] for tool in result["tools"]]
        if not tools:
            raise RuntimeError("Server returned no tools")
        print("Tools:", ", ".join(tools))
        print("PASS: stdio MCP initialization and tool discovery (not GUI execution)")
    finally:
        if process.returncode is None:
            process.terminate()
        try:
            await asyncio.wait_for(process.communicate(), timeout=5)
        except asyncio.TimeoutError:
            process.kill()
            await process.communicate()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", nargs="+", help="MCP launcher and optional arguments")
    asyncio.run(check(parser.parse_args().command))
