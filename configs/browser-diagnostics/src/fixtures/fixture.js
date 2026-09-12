(() => {
    const source = new EventTarget()
    let activityEvents = 0
    let controlEvents = 0
    let controlCycles = 0
    let sink = 0

    function calculateSummary() {
        const until = performance.now() + 180
        while (performance.now() < until) {
            for (let index = 0; index < 10000; index++) {
                sink = (sink + Math.sqrt(index + sink % 97)) % 1000000
            }
        }
    }

    function refreshActivityPreview() {
        const payload = Array.from({ length: 16384 }, () => controlCycles + activityEvents + 1)
        function receiveActivityUpdate() {
            activityEvents += payload[0] > 0 ? 1 : 0
        }
        source.addEventListener('activity-update', receiveActivityUpdate)
        document.getElementById('status').textContent = 'Activity preview refreshed.'
    }

    function refreshDetailsPreview() {
        const element = document.createElement('span')
        const payload = Array.from({ length: 16384 }, () => 1)
        element.textContent = 'Preview details'
        document.getElementById('mount').append(element)
        function receiveDetailsUpdate() {
            controlEvents += payload[0]
            element.textContent = 'Updated details'
        }
        source.addEventListener('details-update', receiveDetailsUpdate)
        source.dispatchEvent(new Event('details-update'))
        source.removeEventListener('details-update', receiveDetailsUpdate)
        element.remove()
        controlCycles++
        document.getElementById('status').textContent = 'Details preview refreshed.'
    }

    document.getElementById('summary').addEventListener('click', calculateSummary)
    document.getElementById('activity').addEventListener('click', refreshActivityPreview)
    document.getElementById('details').addEventListener('click', refreshDetailsPreview)
    // The driver returns primitive values only; it never exports DOM or EventTarget handles.
    window.fixtureActivityEvents = () => {
        activityEvents = 0
        source.dispatchEvent(new Event('activity-update'))
        return activityEvents
    }
    window.fixtureControlEvents = () => controlEvents
    window.fixtureControlCycles = () => controlCycles
    window.fixtureReady = true
})()
