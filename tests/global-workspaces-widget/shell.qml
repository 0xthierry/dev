import QtQuick
import Quickshell
import "fixture"

ShellRoot {
  Window {
    id: host
    visible: true
    width: 320; height: 400
    property bool vertical: false
    property int barSize: 28
    property string fontFamily: "monospace"
    property color barForeground: "white"
    property color urgent: "red"
    property bool foregroundAnimationEnabled: false
    property var buttons: []
    property var commands: []
    function registerClickTarget(button) { buttons.push(button) }
    function unregisterClickTarget(button) { buttons = buttons.filter(b => b !== button) }
    function hideTooltip(button) {}
    function showTooltip(button, text) {}
    function run(command) { commands.push(command) }
    function labels() { return buttons.map(b => b.text) }
    Workspaces { id: widget; bar: host }
    Timer {
      running: true; repeat: true; interval: 30
      property int phase: 0
      onTriggered: {
        if (phase === 0 && widget.activeMode === "scrolling") {
          console.log("LEFT", JSON.stringify(host.labels()))
          host.buttons[0].triggerPress(Qt.LeftButton) // empty 1
          host.buttons[9].triggerPress(Qt.LeftButton) // occupied 14 on another monitor
          host.buttons[8].wheelMoved(-60)
          host.buttons[8].wheelMoved(-60) // 9 -> 14
          console.log("COMMANDS", JSON.stringify(host.commands))
          console.log("HORIZONTAL", host.buttons[1].x > host.buttons[0].x)
          host.vertical = true
          Hyprland.focusedMonitor.name = "HDMI-A-2"
          Hyprland.focusedMonitor.focused = false
          Hyprland.focusedMonitor.activeWorkspace = secondaryWorkspace
          phase++
        } else if (phase === 1 && widget.activeMode === "floating" && host.buttons[3].opacity === 1) {
          console.log("RIGHT", JSON.stringify(host.labels()))
          console.log("VERTICAL", host.buttons[1].y > host.buttons[0].y)
          console.log("OPACITY", JSON.stringify([host.buttons[0].opacity, host.buttons[3].opacity, host.buttons[9].opacity]))
          host.buttons[3].triggerPress(Qt.LeftButton) // layout of this bar, not the focused monitor
          console.log("CYCLE", JSON.stringify(host.commands.slice(-1)))
          Hyprland.workspaces.values = []
          phase++
        } else if (phase === 2) {
          console.log("AFTER_CLOSE", JSON.stringify(host.labels()))
          Qt.quit()
        }
      }
    }
    QtObject { id: secondaryWorkspace; property int id: 4 }
  }
}
