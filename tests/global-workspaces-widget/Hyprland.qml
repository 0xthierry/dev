pragma Singleton
import QtQuick

QtObject {
  property QtObject focusedMonitor: QtObject {
    property string name: "DP-1"
    property bool focused: true
    property QtObject activeWorkspace: QtObject { property int id: 9 }
  }
  property QtObject workspaces: QtObject {
    property var values: [{id: 14, toplevels: {values: [42]}}, {id: 4, toplevels: {values: []}}, {id: -99}]
  }
  signal rawEvent(var event)
}
