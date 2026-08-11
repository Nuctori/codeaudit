// 来自 InitDeity Framework/Module/Automation/RuntimeMainlineAutopilot.cs（截取核心片段——自动化快照）
// 模式：单例访问 + transform.position + 状态快照（state/io 判定锁定）
using UnityEngine;

public sealed class RuntimeMainlineAutopilot : MonoBehaviour
{
    static RuntimeMainlineAutopilot instance;
    Vector2 lastObservedPosition;

    public Transform localPlayerObject;

    public sealed class QuestProgressionManager
    {
        public static QuestProgressionManager instance;
        public QuestInfo activeMainQuestProgression;
        public object questInfo;
    }

    public class QuestInfo
    {
        public int questID;
    }

    public class WorldContainer
    {
        public static WorldContainer TryGetOnlyInstance() => new WorldContainer();
        public string worldName = "world";
        public Loader nowWorldLoader;
    }

    public class Loader
    {
        public string worldLoaderName = "loader";
    }

    public class GuidePoint { }

    void EnsureInteractiveCache() { lastObservedPosition = Vector2.zero; }

    public class Snapshot
    {
        public int activeQuestId;
        public string currentWorld;
        public Vector2 playerPosition;
    }

    Snapshot BuildSnapshot()
    {
        EnsureInteractiveCache();
        var questMgr = QuestProgressionManager.instance;
        var activeQuestId = questMgr?.activeMainQuestProgression?.questInfo?.questID ?? 0;
        var worldContainer = WorldContainer.TryGetOnlyInstance();
        var currentWorld = worldContainer?.worldName ?? string.Empty;
        var playerPosition = localPlayerObject != null
            ? (Vector2)localPlayerObject.transform.position
            : lastObservedPosition;
        var snap = new Snapshot();
        snap.activeQuestId = activeQuestId;
        snap.currentWorld = currentWorld;
        snap.playerPosition = playerPosition;
        return snap;
    }

    void Update()
    {
        if (instance == null) instance = this;
        _ = BuildSnapshot();
    }
}
