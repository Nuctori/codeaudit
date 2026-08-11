// 来自 InitDeity Framework/NonModule/Story/Quest/QuestProgressionManager.cs 与
// Framework/Module/World/Completeness/CompletenessManager.cs（中文标识符——解析器盲区锁定）
public enum WorldRegion
{
    草木之森,
    灵气仙门,
    落霞谷,
}

public sealed class QuestProgressionManager
{
    public sealed class QuestProgression
    {
        public WorldRegion region;
        public int level;
    }

    /// <summary>获得推荐的任务，返回修行之路成就任务</summary>
    public QuestProgression GetRecommendQuestProgression()
    {
        var currentRegion = WorldRegion.草木之森;
        int currentLevel = 1;
        var result = new QuestProgression();
        result.region = currentRegion;
        result.level = currentLevel;
        return result;
    }
}

public static class CompletenessService
{
    public static void AddOneCompleteness(WorldRegion region, int count)
    {
        if (region == WorldRegion.草木之森)
        {
            count += 1;
        }
    }
}
